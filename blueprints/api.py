"""JSON API used by the tracking page to poll for status changes."""
from flask import Blueprint, abort, jsonify

from blueprints import current_customer
from models import ReturnRequest
from services.state_machine import TERMINAL, step_index

bp = Blueprint("api", __name__, url_prefix="/api")


@bp.get("/return/<code>/status")
def return_status(code):
    customer = current_customer()
    if customer is None:
        abort(403)
    ret = ReturnRequest.query.filter_by(return_code=code).first()
    # A return that belongs to someone else is reported as "not found" so the
    # API does not reveal which codes exist.
    if ret is None or ret.customer_id != customer.id:
        abort(404)
    return jsonify({
        "code": ret.return_code,
        "status": ret.status,
        "step": step_index(ret),
        "terminal": ret.status in TERMINAL,
        "updated_at": ret.updated_at.isoformat(timespec="seconds"),
    })
