"""QC inspector pages: the queue and the inspection form."""
from flask import (Blueprint, abort, flash, redirect, render_template, request,
                   url_for)

from blueprints import current_user_id, guard, hand_off
from config import GRADE_REFUND_PERCENT, GRADE_ROUTE
from models import ReturnRequest, return_details
from services.handoff import in_flight
from services.returns import (WorkflowError, is_suspected_fraud,
                              submit_inspection, suggest_grade)
from services.state_machine import RECEIVED, REINSPECTION, InvalidTransition

bp = Blueprint("qc", __name__, url_prefix="/qc")
bp.before_request(guard("qc"))

CHECKS = [
    ("packaging_intact", "Packaging intact"),
    ("tags_attached", "Tags attached"),
    ("item_matches_order", "Item matches order"),
    ("visible_damage", "Visible damage"),
]


@bp.get("/queue")
def queue():
    search = request.args.get("q", "").strip().upper()
    query = ReturnRequest.query.filter(ReturnRequest.status.in_([RECEIVED, REINSPECTION]))
    if search:
        query = query.filter(ReturnRequest.return_code.contains(search))
    items = query.options(*return_details()).order_by(ReturnRequest.updated_at).all()
    return render_template("qc/queue.html", items=items, search=search,
                           moving=in_flight("qc", current_user_id(), 6))


@bp.route("/inspect/<code>", methods=["GET", "POST"])
def inspect(code):
    ret = ReturnRequest.query.filter_by(return_code=code).options(*return_details("qc_reports")).first()
    if ret is None:
        abort(404)

    if request.method == "POST":
        checklist = {key: request.form.get(key) == "on" for key, _ in CHECKS}
        grade = request.form.get("grade", "")
        try:
            submit_inspection(ret, current_user_id(), checklist, grade, request.form.get("remarks", ""))
        except (WorkflowError, InvalidTransition) as err:
            flash(str(err), "error")
            return redirect(url_for("qc.inspect", code=code))
        if ret.status == "Rejected":
            flash(f"{code} rejected as suspected fraud.", "error")
        else:
            flash(f"{code} graded {grade}. Status: {ret.status}.", "success")
        hand_off(ret)
        return redirect(url_for("qc.queue"))

    if ret.status not in (RECEIVED, REINSPECTION):
        flash(f"{code} is '{ret.status}', so there is nothing to inspect.", "info")
        return redirect(url_for("qc.queue"))

    recheck = ret.status == REINSPECTION
    previous = {key: getattr(ret.latest_report, key) for key, _ in CHECKS} if recheck else None
    defaults = previous or {"packaging_intact": True, "tags_attached": True,
                            "item_matches_order": True, "visible_damage": False}
    suggested = suggest_grade(defaults["packaging_intact"], defaults["tags_attached"],
                              defaults["visible_damage"])
    return render_template("qc/inspect.html", ret=ret, checks=CHECKS, defaults=defaults,
                           suggested=suggested, recheck=recheck,
                           percent=GRADE_REFUND_PERCENT, route=GRADE_ROUTE,
                           wrong_item_claim=not is_suspected_fraud(ret, False))
