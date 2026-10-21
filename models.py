"""Database tables (Flask-SQLAlchemy models). One class = one table from the spec."""
from datetime import datetime

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def now():
    """Single place for 'current time' so it is easy to explain and to change."""
    return datetime.now()


class Customer(db.Model):
    __tablename__ = "customers"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    email = db.Column(db.String(120), nullable=False, unique=True)
    phone = db.Column(db.String(20), nullable=False)
    address = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=now)

    orders = db.relationship("Order", back_populates="customer")


class Product(db.Model):
    __tablename__ = "products"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    category = db.Column(db.String(60), nullable=False)
    price = db.Column(db.Float, nullable=False)
    image_url = db.Column(db.String(255), default="")  # placeholder only
    is_returnable = db.Column(db.Boolean, default=True)


class Order(db.Model):
    __tablename__ = "orders"
    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.Integer, db.ForeignKey("customers.id"), nullable=False)
    order_date = db.Column(db.DateTime, nullable=False)
    delivered_at = db.Column(db.DateTime)
    total = db.Column(db.Float, nullable=False)

    customer = db.relationship("Customer", back_populates="orders")
    items = db.relationship("OrderItem", back_populates="order")


class OrderItem(db.Model):
    __tablename__ = "order_items"
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey("orders.id"), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey("products.id"), nullable=False)
    quantity = db.Column(db.Integer, default=1)
    unit_price = db.Column(db.Float, nullable=False)

    order = db.relationship("Order", back_populates="items")
    product = db.relationship("Product")
    returns = db.relationship("ReturnRequest", back_populates="order_item")


class ReturnRequest(db.Model):
    __tablename__ = "return_requests"
    id = db.Column(db.Integer, primary_key=True)
    return_code = db.Column(db.String(20), unique=True, nullable=False)
    order_item_id = db.Column(db.Integer, db.ForeignKey("order_items.id"), nullable=False)
    customer_id = db.Column(db.Integer, db.ForeignKey("customers.id"), nullable=False, index=True)
    reason = db.Column(db.String(40), nullable=False)
    comment = db.Column(db.String(300), default="")
    photo_path = db.Column(db.String(255))
    status = db.Column(db.String(30), nullable=False, default="Requested", index=True)
    refund_status = db.Column(db.String(20), default="Not started")
    flagged_fraud = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=now)
    updated_at = db.Column(db.DateTime, default=now)

    order_item = db.relationship("OrderItem", back_populates="returns")
    customer = db.relationship("Customer")
    pickups = db.relationship("Pickup", back_populates="return_request", order_by="Pickup.attempt_no")
    qc_reports = db.relationship("QCReport", back_populates="return_request", order_by="QCReport.id")
    refurbish_jobs = db.relationship("RefurbishJob", back_populates="return_request")
    refund = db.relationship("Refund", back_populates="return_request", uselist=False)
    history = db.relationship("StatusHistory", back_populates="return_request", order_by="StatusHistory.id")

    @property
    def product(self):
        return self.order_item.product

    @property
    def current_pickup(self):
        return self.pickups[-1] if self.pickups else None

    @property
    def first_report(self):
        """The first (non-recheck) QC report, used for the refund exception."""
        for report in self.qc_reports:
            if not report.is_recheck:
                return report
        return None

    @property
    def latest_report(self):
        return self.qc_reports[-1] if self.qc_reports else None


class Pickup(db.Model):
    __tablename__ = "pickups"
    id = db.Column(db.Integer, primary_key=True)
    return_id = db.Column(db.Integer, db.ForeignKey("return_requests.id"), nullable=False)
    agent_id = db.Column(db.Integer, nullable=False)  # id from config.STAFF["agent"]
    slot_date = db.Column(db.Date, nullable=False)
    slot_window = db.Column(db.String(20), nullable=False)  # Morning / Afternoon / Evening
    attempt_no = db.Column(db.Integer, default=1)
    outcome = db.Column(db.String(20), default="Pending")  # Pending / Picked / Absent
    notes = db.Column(db.String(255), default="")

    return_request = db.relationship("ReturnRequest", back_populates="pickups")


class QCReport(db.Model):
    __tablename__ = "qc_reports"
    id = db.Column(db.Integer, primary_key=True)
    return_id = db.Column(db.Integer, db.ForeignKey("return_requests.id"), nullable=False)
    inspector_id = db.Column(db.Integer, nullable=False)
    packaging_intact = db.Column(db.Boolean, default=False)
    tags_attached = db.Column(db.Boolean, default=False)
    item_matches_order = db.Column(db.Boolean, default=True)
    visible_damage = db.Column(db.Boolean, default=False)
    grade = db.Column(db.String(1))  # A / B / C (empty when rejected as fraud)
    remarks = db.Column(db.String(300), default="")
    is_recheck = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=now)

    return_request = db.relationship("ReturnRequest", back_populates="qc_reports")


class RefurbishJob(db.Model):
    __tablename__ = "refurbish_jobs"
    id = db.Column(db.Integer, primary_key=True)
    return_id = db.Column(db.Integer, db.ForeignKey("return_requests.id"), nullable=False)
    technician_id = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(20), default="Open")  # Open / Repaired
    notes = db.Column(db.String(300), default="")
    created_at = db.Column(db.DateTime, default=now)
    completed_at = db.Column(db.DateTime)

    return_request = db.relationship("ReturnRequest", back_populates="refurbish_jobs")


class Refund(db.Model):
    __tablename__ = "refunds"
    id = db.Column(db.Integer, primary_key=True)
    # unique=True: the database itself refuses a second refund for the same return
    return_id = db.Column(db.Integer, db.ForeignKey("return_requests.id"), nullable=False, unique=True)
    base_amount = db.Column(db.Float, nullable=False)
    grade_percent = db.Column(db.Integer, nullable=False)
    pickup_fee = db.Column(db.Float, nullable=False)
    final_amount = db.Column(db.Float, nullable=False)
    status = db.Column(db.String(20), default="Credited")
    created_at = db.Column(db.DateTime, default=now)

    return_request = db.relationship("ReturnRequest", back_populates="refund")


class InventoryLog(db.Model):
    __tablename__ = "inventory_log"
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("products.id"), nullable=False)
    return_id = db.Column(db.Integer, db.ForeignKey("return_requests.id"), nullable=False)
    action = db.Column(db.String(20), nullable=False)  # Restocked / Refurbished / Scrapped
    quantity = db.Column(db.Integer, default=1)
    created_at = db.Column(db.DateTime, default=now)

    product = db.relationship("Product")
    return_request = db.relationship("ReturnRequest")


class StatusHistory(db.Model):
    __tablename__ = "status_history"
    id = db.Column(db.Integer, primary_key=True)
    return_id = db.Column(db.Integer, db.ForeignKey("return_requests.id"), nullable=False, index=True)
    from_status = db.Column(db.String(30))
    to_status = db.Column(db.String(30), nullable=False)
    actor_role = db.Column(db.String(20), nullable=False)
    actor_name = db.Column(db.String(80), nullable=False)
    note = db.Column(db.String(300), default="")
    created_at = db.Column(db.DateTime, default=now)

    return_request = db.relationship("ReturnRequest", back_populates="history")
