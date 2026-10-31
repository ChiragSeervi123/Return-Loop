"""Landing page and the "switch role / user" control."""
from flask import Blueprint, current_app, flash, redirect, render_template, request, session, url_for

from config import MAKER, PUBLIC_URL, ROLE_HOME, ROLES, STAFF, TEAM
from models import Customer, ReturnRequest, db
from services.handoff import role_noun
from services.stats import landing_stats

bp = Blueprint("main", __name__)


@bp.get("/")
def landing():
    return render_template("landing.html", stats=landing_stats())


def _user_name(role, user_id):
    """The person's name, or None if there is no such user for that role."""
    if role == "customer":
        customer = db.session.get(Customer, user_id)
        return customer.name if customer else None
    return dict(STAFF.get(role, [])).get(user_id)


def _local(url):
    """Only follow `next` to a path on this site, never to another host."""
    return url.startswith("/") and not url.startswith("//") and "\\" not in url


@bp.route("/switch", methods=["GET", "POST"])
def switch():
    """GET shows the full-page role picker; POST stores the choice in the session.

    The handoff card also posts here, with `next` (the page to land on) and
    `code` (the return being passed along).
    """
    if request.method == "GET":
        return render_template("switch.html")

    role, _, uid = request.form.get("who", "").partition(":")
    name = _user_name(role, int(uid)) if role in ROLES and uid.isdigit() else None
    if name is None:
        return redirect(url_for("main.switch"))
    session["role"], session["user_id"] = role, int(uid)
    # A card left over from the last person is not for whoever comes next.
    session.pop("handoff", None)

    code = request.form.get("code", "")
    if code and ReturnRequest.query.filter_by(return_code=code).first():
        session["handoff"] = code
        flash(f"You're {name} now, the {role_noun(role)}. {code} is in your hands.", "info")
    target = request.form.get("next", "")
    return redirect(target if _local(target) else url_for(ROLE_HOME[role]))


@bp.get("/team")
def team():
    members = []
    for i, person in enumerate(TEAM, start=1):
        first, _, last = person["name"].partition(" ")
        members.append({**person, "no": i, "first": first, "last": last,
                        "initials": "".join(part[0] for part in person["name"].split())})
    return render_template("team.html", members=members)


@bp.get("/maker")
def maker():
    """The person who built ReturnLoop: a student ID card."""
    return render_template("maker.html", maker=MAKER)


# Screens shown as prototypes in the documentation: (file in static/docs/proto, caption).
# tools/refresh_docs.py retakes them.
PROTOTYPES = [
    ("landing.jpg", "Landing page"),
    ("orders.jpg", "Customer · My orders"),
    ("new-return.jpg", "Customer · Request return"),
    ("schedule.jpg", "Customer · Book pickup"),
    ("track.jpg", "Customer · Track return, with the handoff card"),
    ("agent.jpg", "Agent · Pickups in a phone"),
    ("warehouse.jpg", "Warehouse · Inbound dock"),
    ("inspect.jpg", "QC · Inspect & grade, on the inspection table"),
    ("workshop.jpg", "Refurbisher · Workshop"),
    ("dashboard.jpg", "Admin · Control room"),
]


@bp.get("/health")
def health():
    """Is the app up, and which database is it on? (sqlite locally, postgresql with Neon)"""
    info = {"ok": True, "database": db.engine.dialect.name}
    if current_app.config.get("STARTUP_ERROR"):   # the shared database failed; running on a local copy
        info["startup_error"] = current_app.config["STARTUP_ERROR"]
    return info


@bp.get("/docs")
def docs():
    """The project documentation: requirements, diagrams, wireframes, prototypes. Prints to A4."""
    return render_template("docs.html", team=[person["name"] for person in TEAM],
                           institute=f"{MAKER['institute']}, {MAKER['campus']}",
                           prototypes=PROTOTYPES, public_url=PUBLIC_URL)


@bp.get("/ppt")
def deck():
    """The project presentation (software engineering view), as slides in the browser."""
    return render_template("deck.html", team=[person["name"] for person in TEAM])


@bp.get("/enter/customer")
def enter_customer():
    """The landing page's "Start a return" button: become the first customer if nobody yet."""
    if session.get("role") != "customer":
        first = Customer.query.order_by(Customer.id).first()
        if first is None:
            return redirect(url_for("main.switch"))
        session["role"], session["user_id"] = "customer", first.id
    return redirect(url_for("customer.orders"))
