"""ReturnLoop entry point. Run with:  python app.py"""
import os

from flask import Flask, render_template, request, session

from blueprints import current_role, current_user_id, current_user_name
from config import ON_VERCEL, ROLE_LABELS, ROLES, STAFF, Config
from models import Customer, ReturnRequest, db
from services.handoff import handoff_for
from services.refund import inr


# Navbar links for each role: (endpoint, label)
NAV = {
    "customer": [("customer.orders", "Orders"), ("customer.returns", "My returns")],
    "agent": [("agent.pickups", "Pickups")],
    "qc": [("qc.queue", "QC queue")],
    "refurbisher": [("refurbisher.jobs", "Repair jobs")],
    "warehouse": [("warehouse.receive", "Receive"), ("warehouse.inventory", "Inventory")],
    "admin": [("admin.dashboard", "Dashboard")],
}


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    db.init_app(app)

    from blueprints.admin import bp as admin_bp
    from blueprints.agent import bp as agent_bp
    from blueprints.api import bp as api_bp
    from blueprints.customer import bp as customer_bp
    from blueprints.main import bp as main_bp
    from blueprints.qc import bp as qc_bp
    from blueprints.refurbisher import bp as refurb_bp
    from blueprints.warehouse import bp as warehouse_bp

    for bp in (main_bp, customer_bp, agent_bp, qc_bp, refurb_bp, warehouse_bp, admin_bp, api_bp):
        app.register_blueprint(bp)

    app.add_template_filter(inr, "inr")

    @app.template_filter("when")
    def when(value):
        return value.strftime("%d %b, %H:%M") if value else ""

    @app.context_processor
    def inject_user():
        """Makes the current role and the switcher list available in every template."""
        people = {"customer": [(c.id, c.name) for c in Customer.query.order_by(Customer.id)]}
        people.update(STAFF)
        # Set by the last action (or a handoff switch); shown once, on this page.
        handoff = None
        code = session.pop("handoff", None)
        ret = code and ReturnRequest.query.filter_by(return_code=code).first()
        if ret:
            handoff = handoff_for(ret, current_role(), current_user_id())
        return {
            "handoff": handoff,
            "role": current_role(),
            "user_id": current_user_id(),
            "user_name": current_user_name(),
            "roles": ROLES,
            "role_labels": ROLE_LABELS,
            "people": people,
            "nav": NAV,
        }

    @app.errorhandler(403)
    def forbidden(err):
        if request.path.startswith("/api/"):
            return {"error": "forbidden"}, 403
        needed = getattr(err, "description", "")
        return render_template("errors/403.html", needed=needed if needed in ROLES else None), 403

    @app.errorhandler(404)
    def not_found(err):
        if request.path.startswith("/api/"):
            return {"error": "not found"}, 404
        return render_template("errors/404.html"), 404

    @app.errorhandler(413)
    def too_large(err):
        return render_template("errors/413.html"), 413

    @app.after_request
    def cache_static(response):
        """Let Vercel's edge keep CSS/JS near the visitor (s-maxage) instead of asking
        the Python function every time. Each deploy clears that cache, so files never go
        stale; browsers still revalidate (max-age=0). Uploaded photos are not cached."""
        if request.endpoint == "static" and response.status_code == 200 \
                and not request.view_args.get("filename", "").startswith("uploads/"):
            response.headers["Cache-Control"] = "public, max-age=0, must-revalidate, s-maxage=31536000"
        return response

    return app


# Top-level instance so hosts like Vercel can find the app.
app = create_app()

if ON_VERCEL:
    # Each serverless instance starts with an empty /tmp, so fill it with the demo data.
    with app.app_context():
        if not db.inspect(db.engine).has_table("customers"):
            from seed import main as seed_demo
            seed_demo()


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)
