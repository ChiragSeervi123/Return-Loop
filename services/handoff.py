"""The relay between desks: once someone finishes their part of a return,
who picks it up next and which page they should land on.

The app shows this as a "handoff" card after every action, so a demo can
follow one return from the customer's door to the admin dashboard without
touching the role menu.
"""
from config import ROLE_LABELS, ROLES, STAFF
from models import Pickup, ReturnRequest, StatusHistory, return_details
from services.state_machine import (CANCELLED, CLOSED, PICKED_UP,
                                    PICKUP_SCHEDULED, RECEIVED, REFUNDED,
                                    REFURBISHING, REINSPECTION, REJECTED,
                                    REQUESTED, TERMINAL)


def _staff(role, staff_id=None):
    """(id, name) of a staff member; the first one when no id is given."""
    people = dict(STAFF[role])
    if staff_id not in people:
        staff_id = STAFF[role][0][0]
    return staff_id, people[staff_id]


def role_noun(role):
    """The role label for mid-sentence use: "pickup agent", but "QC inspector"."""
    label = ROLE_LABELS[role]
    return label if label[:2].isupper() else label[0].lower() + label[1:]


def _desk(role, user_id, name, task, endpoint, **args):
    return {"role": role, "user_id": user_id, "name": name, "label": ROLE_LABELS[role],
            "noun": role_noun(role), "task": task, "endpoint": endpoint, "args": args}


def next_desk(ret):
    """Who acts on `ret` next, as a dict, or None if it is mid-move (never at rest)."""
    status, code = ret.status, ret.return_code

    if status == REQUESTED:
        return _desk("customer", ret.customer_id, ret.customer.name, "books a pickup slot.",
                     "customer.schedule", code=code)
    if status == PICKUP_SCHEDULED:
        p = ret.current_pickup
        uid, name = _staff("agent", p.agent_id)
        return _desk("agent", uid, name,
                     f"collects the parcel on {p.slot_date:%a %d %b}, {p.slot_window}.",
                     "agent.pickup", pickup_id=p.id)
    if status == PICKED_UP:
        uid, name = _staff("warehouse")
        return _desk("warehouse", uid, name, "checks the parcel in at the returns centre.",
                     "warehouse.receive", focus=code)
    if status == RECEIVED:
        uid, name = _staff("qc")
        return _desk("qc", uid, name, "inspects it and gives it a grade.", "qc.inspect", code=code)
    if status == REFURBISHING:
        open_jobs = [j for j in ret.refurbish_jobs if j.status == "Open"]
        uid, name = _staff("refurbisher", open_jobs[-1].technician_id if open_jobs else None)
        return _desk("refurbisher", uid, name, "repairs it before a second QC check.",
                     "refurbisher.jobs", focus=code)
    if status == REINSPECTION:
        uid, name = _staff("qc")
        return _desk("qc", uid, name, "checks the repair and settles the refund.",
                     "qc.inspect", code=code)
    if status == REFUNDED:
        return _desk("customer", ret.customer_id, ret.customer.name,
                     "confirms the refund arrived and closes the return.",
                     "customer.track", code=code)
    if status in (REJECTED, CANCELLED):
        return _desk("customer", ret.customer_id, ret.customer.name,
                     "finds out why the return stopped.", "customer.track", code=code)
    if status == CLOSED:
        uid, name = _staff("admin")
        return _desk("admin", uid, name, "sees the finished return in the numbers.",
                     "admin.dashboard")
    return None


def relay(ret, next_role=None):
    """The six desks in process order, each marked done / next / skipped / ahead.

    A desk is done once someone at it has acted on this return. The refurbisher
    is skipped when QC graded anything but B. With no next_role the loop has
    ended: a closed return finishes at the admin, and any desk it never
    reached counts as skipped.
    """
    acted = {h.actor_role for h in ret.history}
    if next_role is None and ret.status == CLOSED:
        acted.add("admin")
    first = ret.first_report
    skip_refurb = (first is not None and first.grade != "B") or ret.status in (REJECTED, CANCELLED)
    stations = []
    for role in ROLES:
        if role == next_role:
            state = "next"
        elif role in acted:
            state = "done"
        elif next_role is None or (role == "refurbisher" and skip_refurb):
            state = "skipped"
        else:
            state = "ahead"
        stations.append({"role": role, "label": ROLE_LABELS[role], "state": state})
    return stations


def handoff_for(ret, role, user_id):
    """The card to show `role`/`user_id` right after they acted on `ret`, or None.

    kind "pass": someone else is up next, offer to continue as them.
    kind "end":  the viewer is the last desk for a finished return.
    """
    desk = next_desk(ret)
    if desk is None:
        return None
    is_me = desk["role"] == role and desk["user_id"] == user_id
    if not is_me:
        return {"kind": "pass", "ret": ret, "desk": desk, "note": ret.history[-1].note,
                "relay": relay(ret, desk["role"])}
    if ret.status in TERMINAL:
        return {"kind": "end", "ret": ret, "desk": desk, "note": ret.history[-1].note,
                "relay": relay(ret)}
    return None


def in_flight(role, user_id, limit=None):
    """Unfinished returns this desk has handed on, each with who holds it now.

    The admin never acts on a return, so for the admin this is every return
    still moving. Returns waiting on this same person are left out: those are
    already in their own work list.
    """
    query = ReturnRequest.query.filter(ReturnRequest.status.notin_(TERMINAL))
    if role == "customer":
        query = query.filter(ReturnRequest.customer_id == user_id)
    elif role != "admin":
        query = query.filter(ReturnRequest.history.any(StatusHistory.actor_role == role))
    if role == "agent":
        query = query.filter(ReturnRequest.pickups.any(Pickup.agent_id == user_id))

    rows = []
    for ret in query.options(*return_details()).order_by(ReturnRequest.updated_at.desc()):
        desk = next_desk(ret)
        if desk is None or (desk["role"] == role and desk["user_id"] == user_id):
            continue
        rows.append({"ret": ret, "desk": desk})
        if len(rows) == limit:
            break
    return rows
