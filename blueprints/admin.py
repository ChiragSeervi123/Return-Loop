"""Admin dashboard (the control room), and the demo-data reset."""
import os

from flask import Blueprint, current_app, flash, redirect, render_template, session, url_for

from blueprints import current_user_id, guard
from services.stats import dashboard_stats
from services.flags import flagged_customers
from models import StatusHistory
from services.handoff import in_flight

bp = Blueprint("admin", __name__, url_prefix="/admin")
bp.before_request(guard("admin"))


@bp.get("/dashboard")
def dashboard():
    return render_template("admin/dashboard.html", stats=dashboard_stats(),
                           flagged=flagged_customers(),
                           moving=in_flight("admin", current_user_id(), 12),
                           feed=StatusHistory.query.order_by(StatusHistory.id.desc()).limit(8).all())


@bp.post("/reset")
def reset():
    """Put the demo data back, dated from now: every order returnable again, no returns
    in progress. With a shared database the demo would otherwise age out of the 7-day
    window and run out of returnable items. Locally this does what reset.bat does."""
    from seed import fill, rebuild_lock
    with rebuild_lock():
        fill()
    folder = current_app.config["UPLOAD_FOLDER"]
    for name in os.listdir(folder) if os.path.isdir(folder) else []:
        if name != ".gitkeep":
            os.remove(os.path.join(folder, name))
    session.pop("handoff", None)
    flash("Demo data reset: fresh orders dated from today, nothing in the loop.", "success")
    return redirect(url_for("admin.dashboard"))
