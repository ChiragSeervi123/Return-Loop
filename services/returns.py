"""The return workflow: one function per action a person can take.

Route handlers only read the form and call these. All rules live here,
in the other services, and in config.py.
"""
from datetime import timedelta

from config import (COMMENT_MAX_CHARS, GRADE_ROUTE, MAX_PICKUP_ATTEMPTS,
                    PICKUP_MAX_DAYS_AHEAD, PICKUP_SLOTS, RETURN_REASONS, STAFF)
from models import Pickup, QCReport, RefurbishJob, ReturnRequest, StatusHistory, db, now
from services.eligibility import check_eligibility
from services.refund import issue_refund
from services.state_machine import (CANCELLED, CLOSED, INSPECTED, PICKED_UP,
                                    PICKUP_SCHEDULED, RECEIVED, REFURBISHING,
                                    REINSPECTION, REJECTED, REQUESTED,
                                    RESTOCKED, SCRAPPED, change_status)


class WorkflowError(Exception):
    """A friendly, user-facing reason why an action could not be done."""


# ---------------------------------------------------------------- customer

def next_return_code(year=None):
    year = year or now().year
    prefix = f"RL-{year}-"
    last = (ReturnRequest.query.filter(ReturnRequest.return_code.like(prefix + "%"))
            .order_by(ReturnRequest.return_code.desc()).first())
    number = int(last.return_code.split("-")[-1]) + 1 if last else 1
    return f"{prefix}{number:04d}"


def create_return(customer, order_item, reason, comment="", photo_path=None, today=None):
    if order_item.order.customer_id != customer.id:
        raise WorkflowError("That item is not in your orders.")
    ok, why = check_eligibility(order_item, today)
    if not ok:
        raise WorkflowError(f"This item can't be returned: {why.lower()}.")
    if reason not in RETURN_REASONS:
        raise WorkflowError("Pick a reason for the return.")
    comment = (comment or "").strip()
    if len(comment) > COMMENT_MAX_CHARS:
        raise WorkflowError(f"Keep the comment under {COMMENT_MAX_CHARS} characters.")

    created = today or now()
    ret = ReturnRequest(
        return_code=next_return_code(created.year),
        order_item_id=order_item.id,
        customer_id=customer.id,
        reason=reason,
        comment=comment,
        photo_path=photo_path,
        status=REQUESTED,
        created_at=created,
        updated_at=created,
    )
    db.session.add(ret)
    db.session.flush()  # gives ret an id for the history row
    # The very first history row: the return comes into existence.
    db.session.add(StatusHistory(return_id=ret.id, from_status=None, to_status=REQUESTED,
                                 actor_role="customer", actor_name=customer.name,
                                 note=f"Reason: {reason}", created_at=created))
    db.session.commit()
    return ret


def pickup_dates(today=None):
    """The dates a customer may choose: tomorrow up to PICKUP_MAX_DAYS_AHEAD days."""
    today = (today or now()).date()
    return [today + timedelta(days=i) for i in range(1, PICKUP_MAX_DAYS_AHEAD + 1)]


def pick_agent():
    """Give the pickup to the agent with the fewest pending pickups."""
    def load(agent):
        return Pickup.query.filter_by(agent_id=agent[0], outcome="Pending").count()
    return min(STAFF["agent"], key=load)[0]


def schedule_pickup(ret, slot_date, slot_window, actor_name, today=None):
    """First booking (Requested) or a reschedule (Pickup Scheduled)."""
    if slot_date not in pickup_dates(today):
        raise WorkflowError("Pick a date between tomorrow and 5 days from now.")
    if slot_window not in PICKUP_SLOTS:
        raise WorkflowError("Pick a time slot.")

    nice = f"{slot_date:%a %d %b}, {slot_window}"
    if ret.status == REQUESTED:
        db.session.add(Pickup(return_id=ret.id, agent_id=pick_agent(), slot_date=slot_date,
                              slot_window=slot_window, attempt_no=1))
        change_status(ret, PICKUP_SCHEDULED, "customer", actor_name, f"Pickup booked for {nice}.")
    elif ret.status == PICKUP_SCHEDULED:
        pickup = ret.current_pickup
        pickup.slot_date, pickup.slot_window = slot_date, slot_window
        change_status(ret, PICKUP_SCHEDULED, "customer", actor_name, f"Rescheduled to {nice}.")
    else:
        raise WorkflowError("This return is past the pickup stage.")
    return ret


def close_return(ret, actor_name):
    change_status(ret, CLOSED, "customer", actor_name, "Customer confirmed the refund arrived.")


# ------------------------------------------------------------------- agent

def _pending_pickup(pickup):
    if pickup.outcome != "Pending" or pickup.return_request.status != PICKUP_SCHEDULED:
        raise WorkflowError("This pickup has already been handled.")


def mark_picked_up(pickup, agent_name, notes=""):
    _pending_pickup(pickup)
    pickup.outcome = "Picked"
    pickup.notes = notes
    change_status(pickup.return_request, PICKED_UP, "agent", agent_name, "Parcel collected from customer.")


def mark_absent(pickup, agent_name, notes="", today=None):
    """Customer not home. First time: rebook for the next day. Second time: cancel."""
    _pending_pickup(pickup)
    ret = pickup.return_request
    pickup.outcome = "Absent"
    pickup.notes = notes

    if pickup.attempt_no >= MAX_PICKUP_ATTEMPTS:
        change_status(ret, CANCELLED, "agent", agent_name,
                      f"Customer absent on {MAX_PICKUP_ATTEMPTS} pickup attempts, so the return was cancelled.")
        return ret

    today = (today or now()).date()
    next_day = max(today, pickup.slot_date) + timedelta(days=1)
    db.session.add(Pickup(return_id=ret.id, agent_id=pickup.agent_id, slot_date=next_day,
                          slot_window=pickup.slot_window, attempt_no=pickup.attempt_no + 1))
    change_status(ret, PICKUP_SCHEDULED, "agent", agent_name,
                  f"Customer absent (attempt {pickup.attempt_no} of {MAX_PICKUP_ATTEMPTS}). "
                  f"Retrying {next_day:%a %d %b}, {pickup.slot_window}.")
    return ret


# --------------------------------------------------------------- warehouse

def mark_received(ret, manager_name):
    change_status(ret, RECEIVED, "warehouse", manager_name, "Arrived at the returns centre.")


# ---------------------------------------------------------------------- QC

def suggest_grade(packaging_intact, tags_attached, visible_damage):
    """A starting suggestion from the checklist. The inspector can override it."""
    if visible_damage and not packaging_intact:
        return "C"
    if visible_damage or not packaging_intact or not tags_attached:
        return "B"
    return "A"


def is_suspected_fraud(ret, item_matches_order):
    """A mismatched item is fraud, unless the customer said they got the wrong item."""
    return not item_matches_order and ret.reason != "Wrong item"


def submit_inspection(ret, inspector_id, checklist, grade, remarks=""):
    """QC submits a report. Handles first inspection, fraud rejection and re-inspection.

    Everything (report, status moves, refurbish job, refund) is committed together.
    """
    inspector = dict(STAFF["qc"]).get(inspector_id, "QC")
    remarks = (remarks or "").strip()[:300]
    report = QCReport(return_id=ret.id, inspector_id=inspector_id, remarks=remarks,
                      is_recheck=(ret.status == REINSPECTION), **checklist)

    try:
        if ret.status == RECEIVED:
            if is_suspected_fraud(ret, checklist["item_matches_order"]):
                report.grade = None
                db.session.add(report)
                ret.flagged_fraud = True
                change_status(ret, REJECTED, "qc", inspector,
                              "Item does not match the order. Rejected as suspected fraud.")
                return ret
            if grade not in GRADE_ROUTE:
                raise WorkflowError("Choose grade A, B or C.")
            report.grade = grade
            db.session.add(report)
            change_status(ret, INSPECTED, "qc", inspector, f"Graded {grade}.", commit=False)
            route = GRADE_ROUTE[grade]
            change_status(ret, route, "qc", inspector, _route_note(grade), commit=False)
            if route == REFURBISHING:
                technician = STAFF["refurbisher"][0][0]
                db.session.add(RefurbishJob(return_id=ret.id, technician_id=technician))
                db.session.commit()
            else:
                issue_refund(ret, "qc", inspector, route)  # commits everything

        elif ret.status == REINSPECTION:
            # Re-inspection: B means the repair passed, C means it failed.
            if grade not in ("B", "C"):
                raise WorkflowError("On re-inspection choose B (repair passed) or C (failed).")
            report.grade = grade
            db.session.add(report)
            if grade == "B":
                change_status(ret, RESTOCKED, "qc", inspector, "Repair passed re-inspection.", commit=False)
                issue_refund(ret, "qc", inspector, "Refurbished")
            else:
                change_status(ret, SCRAPPED, "qc", inspector,
                              "Repair failed re-inspection. Now grade C.", commit=False)
                issue_refund(ret, "qc", inspector, "Scrapped")
        else:
            raise WorkflowError(f"{ret.return_code} is not waiting for inspection.")
    except Exception:
        db.session.rollback()
        raise
    return ret


def _route_note(grade):
    return {
        "A": "Grade A: back on the shelf.",
        "B": "Grade B: sent for refurbishing.",
        "C": "Grade C: scrapped.",
    }[grade]


# ------------------------------------------------------------- refurbisher

def mark_repaired(job, technician_name, notes=""):
    if job.status != "Open":
        raise WorkflowError("This job is already marked repaired.")
    job.status = "Repaired"
    job.notes = (notes or "").strip()[:300]
    job.completed_at = now()
    change_status(job.return_request, REINSPECTION, "refurbisher", technician_name,
                  "Repaired. Waiting for QC re-inspection.")
