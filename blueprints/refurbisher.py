"""Refurbisher page: open repair jobs."""
from flask import Blueprint, abort, flash, redirect, render_template, request, url_for

from blueprints import current_user_id, current_user_name, guard, hand_off
from models import RefurbishJob, db
from services.handoff import in_flight
from services.returns import WorkflowError, mark_repaired
from services.state_machine import InvalidTransition

bp = Blueprint("refurbisher", __name__, url_prefix="/refurb")
bp.before_request(guard("refurbisher"))


@bp.get("/jobs")
def jobs():
    open_jobs = RefurbishJob.query.filter_by(status="Open").order_by(RefurbishJob.created_at).all()
    done = (RefurbishJob.query.filter_by(status="Repaired")
            .order_by(RefurbishJob.completed_at.desc()).limit(5).all())
    return render_template("refurbisher/jobs.html", jobs=open_jobs, done=done,
                           moving=in_flight("refurbisher", current_user_id(), 6))


@bp.post("/jobs/<int:job_id>/repaired")
def repaired(job_id):
    job = db.session.get(RefurbishJob, job_id)
    if job is None:
        abort(404)
    try:
        mark_repaired(job, current_user_name(), request.form.get("notes", ""))
        flash(f"{job.return_request.return_code} sent to QC for re-inspection.", "success")
        hand_off(job.return_request)
    except (WorkflowError, InvalidTransition) as err:
        flash(str(err), "error")
    return redirect(url_for("refurbisher.jobs"))
