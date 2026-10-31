"""Warehouse manager pages: receiving parcels and the inventory view."""
from flask import Blueprint, abort, flash, redirect, render_template, request, url_for
from sqlalchemy.orm import joinedload

from blueprints import current_user_id, current_user_name, guard, hand_off
from models import InventoryLog, ReturnRequest, return_details
from services.handoff import in_flight
from services.returns import mark_received
from services.state_machine import PICKED_UP, InvalidTransition

bp = Blueprint("warehouse", __name__, url_prefix="/warehouse")
bp.before_request(guard("warehouse"))

ACTIONS = ("Restocked", "Refurbished", "Scrapped")


@bp.get("/receive")
def receive():
    incoming = (ReturnRequest.query.filter_by(status=PICKED_UP).options(*return_details())
                .order_by(ReturnRequest.updated_at).all())
    return render_template("warehouse/receive.html", incoming=incoming,
                           moving=in_flight("warehouse", current_user_id(), 6))


@bp.post("/receive/<code>")
def receive_one(code):
    ret = ReturnRequest.query.filter_by(return_code=code).first()
    if ret is None:
        abort(404)
    try:
        mark_received(ret, current_user_name())
        flash(f"{code} checked in. It's in the QC queue now.", "success")
        hand_off(ret)
    except InvalidTransition as err:
        flash(str(err), "error")
    return redirect(url_for("warehouse.receive"))


@bp.get("/inventory")
def inventory():
    action = request.args.get("action", "")
    query = InventoryLog.query
    if action in ACTIONS:
        query = query.filter_by(action=action)
    logs = (query.options(joinedload(InventoryLog.product), joinedload(InventoryLog.return_request))
            .order_by(InventoryLog.created_at.desc()).all())
    counts = {a: sum(l.quantity for l in InventoryLog.query.filter_by(action=a)) for a in ACTIONS}
    return render_template("warehouse/inventory.html", logs=logs, counts=counts,
                           actions=ACTIONS, current=action)
