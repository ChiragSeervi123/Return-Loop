"""ReturnLoop entry point. Run with:  python app.py"""
import os

from flask import Flask, render_template, request

from blueprints import current_role, current_user_id, current_user_name
from config import ROLES, STAFF, Config
from models import Customer, db


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
