"""Refurbisher page: the workshop. Open repair jobs as tickets, and a service book of
recent repairs with QC's verdict on each."""
from flask import Blueprint, abort, flash, redirect, render_template, request, url_for

from blueprints import current_user_name, guard, hand_off
from config import STAFF
from models import RefurbishJob, db, now
from services.handoff import next_desk
from services.returns import WorkflowError, mark_repaired
from services.state_machine import REINSPECTION, TERMINAL, InvalidTransition

bp = Blueprint("refurbisher", __name__, url_prefix="/refurb")
bp.before_request(guard("refurbisher"))


def fix_list(report):
    """QC's findings turned into a to-do list: (what to do, how it reads in the notes)."""
    fixes = []
    if report is not None:
        if not report.packaging_intact:
            fixes.append(("Re-box and re-tape", "Re-boxed and re-taped"))
        if not report.tags_attached:
            fixes.append(("Re-attach the tags", "Re-attached tags"))
        if report.visible_damage:
            fixes.append(("Repair the damage", "Repaired the damage"))
    fixes.append(("Clean and test", "Cleaned and tested"))
    return fixes


def verdict(ret):
    """What QC decided after the repair, as (stamp text, tone)."""
    report = ret.latest_report
    if ret.status == REINSPECTION:
        return "AWAITING RECHECK", "wait"
    if report is not None and report.is_recheck:
        return ("PASSED · RESTOCKED", "a") if report.grade == "B" else ("FAILED · SCRAPPED", "c")
    return "", ""


@bp.get("/jobs")
def jobs():
    today = now()
    inspectors = dict(STAFF["qc"])
    tickets = []
    for job in RefurbishJob.query.filter_by(status="Open").order_by(RefurbishJob.created_at):
        report = job.return_request.first_report
        tickets.append({"job": job, "ret": job.return_request, "report": report,
                        "fixes": fix_list(report), "days": (today - job.created_at).days,
                        "inspector": inspectors.get(report.inspector_id, "QC") if report else "QC"})

    technicians = dict(STAFF["refurbisher"])
    records = []
    for job in (RefurbishJob.query.filter_by(status="Repaired")
                .order_by(RefurbishJob.completed_at.desc()).limit(5)):
        ret = job.return_request
        desk = next_desk(ret) if ret.status not in TERMINAL else None
        stamp, tone = verdict(ret)
        records.append({"job": job, "ret": ret, "stamp": stamp, "tone": tone,
                        "technician": technicians.get(job.technician_id, "Workshop"),
                        "desk": desk if desk and desk["role"] != "refurbisher" else None})
    return render_template("refurbisher/jobs.html", tickets=tickets, records=records)


@bp.post("/jobs/<int:job_id>/repaired")
def repaired(job_id):
    job = db.session.get(RefurbishJob, job_id)
    if job is None:
        abort(404)
    # no notes typed: the ticked fixes become the notes
    notes = request.form.get("notes", "").strip() or ", ".join(request.form.getlist("fix"))
    try:
        mark_repaired(job, current_user_name(), notes)
        flash(f"{job.return_request.return_code} sent to QC for re-inspection.", "success")
        hand_off(job.return_request)
    except (WorkflowError, InvalidTransition) as err:
        flash(str(err), "error")
    return redirect(url_for("refurbisher.jobs"))
