"""ReturnLoop entry point. Run with:  python app.py"""
import os

from flask import Flask, render_template, request

from blueprints import current_role, current_user_id, current_user_name
from config import ROLES, STAFF, Config
from models import Customer, db


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

    @app.template_filter("inr")
    def inr(amount):
        """₹ with Indian digit grouping: 123456 -> ₹1,23,456."""
        whole, paise = divmod(round(float(amount or 0) * 100), 100)
        digits = str(int(whole))
        if len(digits) > 3:
            head, tail = digits[:-3], digits[-3:]
            groups = []
            while len(head) > 2:
                groups.insert(0, head[-2:])
                head = head[:-2]
            digits = ",".join(([head] if head else []) + groups) + "," + tail
        return f"₹{digits}" + (f".{paise:02d}" if paise else "")

    @app.template_filter("when")
    def when(value):
        return value.strftime("%d %b, %H:%M") if value else ""

    @app.context_processor
    def inject_user():
        """Makes the current role and the switcher list available in every template."""
        people = {"customer": [(c.id, c.name) for c in Customer.query.order_by(Customer.id)]}
        people.update(STAFF)
        return {
            "role": current_role(),
            "user_id": current_user_id(),
            "user_name": current_user_name(),
            "roles": ROLES,
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

    return app


if __name__ == "__main__":
    app = create_app()
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)
