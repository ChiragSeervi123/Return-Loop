"""Pickup agent pages (phone-first)."""
from flask import Blueprint, abort, flash, redirect, render_template, request, url_for
from sqlalchemy.orm import joinedload

from blueprints import current_user_id, current_user_name, guard, hand_off
from config import PICKUP_SLOTS, SLOT_HOURS
from models import Pickup, db, now, return_details
from services.handoff import in_flight, next_desk
from services.returns import WorkflowError, mark_absent, mark_picked_up
from services.state_machine import InvalidTransition

bp = Blueprint("agent", __name__, url_prefix="/agent")
bp.before_request(guard("agent"))


def _slot_order(pickup):
    return (pickup.slot_date, PICKUP_SLOTS.index(pickup.slot_window))


@bp.get("/pickups")
def pickups():
    pending = (Pickup.query.filter_by(agent_id=current_user_id(), outcome="Pending")
               .options(joinedload(Pickup.return_request).options(*return_details())).all())
    pending.sort(key=_slot_order)
    today = now().date()
    return render_template("agent/pickups.html",
                           today_list=[p for p in pending if p.slot_date <= today],
                           upcoming=[p for p in pending if p.slot_date > today],
                           slot_hours=SLOT_HOURS, today=today,
                           moving=in_flight("agent", current_user_id(), 6))


@bp.route("/pickup/<int:pickup_id>", methods=["GET", "POST"])
def pickup(pickup_id):
    p = db.session.get(Pickup, pickup_id)
    if p is None or p.agent_id != current_user_id():
        abort(404)
    if request.method == "POST":
        action = request.form.get("action")
        notes = request.form.get("notes", "")[:255]
        try:
            if action == "picked":
                mark_picked_up(p, current_user_name(), notes)
                flash(f"{p.return_request.return_code} picked up.", "success")
            elif action == "absent":
                ret = mark_absent(p, current_user_name(), notes)
                if ret.status == "Cancelled":
                    flash(f"{ret.return_code} cancelled after a second missed pickup.", "info")
                else:
                    flash(f"Absent noted. {ret.return_code} rebooked for tomorrow.", "info")
            hand_off(p.return_request)
        except (WorkflowError, InvalidTransition) as err:
            flash(str(err), "error")
        return redirect(url_for("agent.pickups"))
    return render_template("agent/pickup.html", p=p, slot_hours=SLOT_HOURS,
                           desk=next_desk(p.return_request))
