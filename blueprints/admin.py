"""Admin dashboard."""
from flask import Blueprint, render_template

from blueprints import current_user_id, guard
from services.stats import dashboard_stats
from services.flags import flagged_customers
from services.handoff import in_flight

bp = Blueprint("admin", __name__, url_prefix="/admin")
bp.before_request(guard("admin"))


@bp.get("/dashboard")
def dashboard():
    return render_template("admin/dashboard.html", stats=dashboard_stats(),
                           flagged=flagged_customers(),
                           moving=in_flight("admin", current_user_id(), 12))
