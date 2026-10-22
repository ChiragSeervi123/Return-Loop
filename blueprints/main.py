"""Landing page and the "switch role / user" control."""
from flask import Blueprint, redirect, render_template, request, session, url_for

from config import ROLE_HOME, ROLES, STAFF, TEAM
from models import Customer, db
from services.stats import landing_stats

bp = Blueprint("main", __name__)


@bp.get("/")
def landing():
    return render_template("landing.html", stats=landing_stats())


def _valid_user(role, user_id):
    if role == "customer":
        return db.session.get(Customer, user_id) is not None
    return user_id in dict(STAFF.get(role, []))


@bp.route("/switch", methods=["GET", "POST"])
def switch():
    """GET shows the full-page role picker; POST stores the choice in the session."""
    if request.method == "GET":
        return render_template("switch.html")

    role, _, uid = request.form.get("who", "").partition(":")
    if role not in ROLES or not uid.isdigit() or not _valid_user(role, int(uid)):
        return redirect(url_for("main.switch"))
    session["role"], session["user_id"] = role, int(uid)
    return redirect(url_for(ROLE_HOME[role]))


@bp.get("/team")
def team():
    members = []
    for i, person in enumerate(TEAM, start=1):
        first, _, last = person["name"].partition(" ")
        members.append({**person, "no": i, "first": first, "last": last,
                        "initials": "".join(part[0] for part in person["name"].split())})
    return render_template("team.html", members=members)


@bp.get("/enter/customer")
def enter_customer():
    """The landing page's "Start a return" button: become the first customer if nobody yet."""
    if session.get("role") != "customer":
        first = Customer.query.order_by(Customer.id).first()
        if first is None:
            return redirect(url_for("main.switch"))
        session["role"], session["user_id"] = "customer", first.id
    return redirect(url_for("customer.orders"))
