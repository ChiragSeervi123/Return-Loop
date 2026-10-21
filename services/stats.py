"""Numbers for the landing page strip and the admin dashboard."""
from config import RETURN_REASONS
from models import InventoryLog, QCReport, Refund, ReturnRequest
from services.state_machine import CLOSED, REFUNDED, TERMINAL


def landing_stats():
    return {
        "returns": ReturnRequest.query.count(),
        "refunded": round(sum(r.final_amount for r in Refund.query.all())),
        "rescued": InventoryLog.query.filter(InventoryLog.action != "Scrapped").count(),
        "closed": ReturnRequest.query.filter(ReturnRequest.status.in_([REFUNDED, CLOSED])).count(),
    }


def dashboard_stats():
    returns = ReturnRequest.query.all()
    reasons = {reason: 0 for reason in RETURN_REASONS}
    for ret in returns:
        reasons[ret.reason] = reasons.get(ret.reason, 0) + 1

    # Grades from first inspections only, so a recheck does not count twice.
    grades = {"A": 0, "B": 0, "C": 0}
    for report in QCReport.query.filter_by(is_recheck=False).all():
        if report.grade in grades:
            grades[report.grade] += 1

    return {
        "total": len(returns),
        "in_progress": sum(1 for r in returns if r.status not in TERMINAL and r.status != REFUNDED),
        "refunded_amount": round(sum(r.final_amount for r in Refund.query.all())),
        "fraud": sum(1 for r in returns if r.flagged_fraud),
        "reasons": reasons,
        "grades": grades,
    }
