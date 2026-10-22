"""App configuration and every business rule constant in one place.

If a number changes (return window, fee, refund percentage), change it here only.
"""
import os
import tempfile

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "returnloop-dev-secret")
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL", "sqlite:///" + os.path.join(BASE_DIR, "returnloop.db")
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads")
    # Flask rejects any request body above this with a 413. We set it a little
    # above MAX_PHOTO_BYTES so the friendly "photo too large" check can run first.
    MAX_CONTENT_LENGTH = 4 * 1024 * 1024
    TESTING = False


class TestConfig(Config):
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    TESTING = True
    UPLOAD_FOLDER = os.path.join(tempfile.gettempdir(), "returnloop-test-uploads")


# ---------------------------------------------------------------------------
# Business rules (section 7 of the spec)
# ---------------------------------------------------------------------------

# A customer can request a return up to this many days after delivery.
RETURN_WINDOW_DAYS = 7

# Refund percentage per QC grade. Grade B only gets this after the
# refurbished item passes re-inspection.
GRADE_REFUND_PERCENT = {"A": 100, "B": 70, "C": 0}

# Where an item goes after its first QC grade.
GRADE_ROUTE = {"A": "Restocked", "B": "Refurbishing", "C": "Scrapped"}

# Reasons that get a full refund when the QC report confirms them,
# whatever the grade. The item is still routed by grade.
FULL_REFUND_REASONS = ("Damaged", "Wrong item")

# Flat pickup fee in rupees, charged only when the customer simply changed their mind.
PICKUP_FEE = 50
PICKUP_FEE_REASONS = ("Changed my mind",)

# After this many "customer absent" pickups the return is cancelled.
MAX_PICKUP_ATTEMPTS = 2

# Customers with MORE than this many return requests in the window are flagged.
FREQUENT_RETURN_LIMIT = 3
FREQUENT_RETURN_DAYS = 30

# Return reasons shown to the customer, with a short hint for each tile.
RETURN_REASONS = {
    "Damaged": "Arrived broken, cracked or dented.",
    "Wrong item": "Not what you ordered.",
    "Not as described": "Size, colour or spec doesn't match the listing.",
    "Changed my mind": "No fault needed. A ₹50 pickup fee comes off the refund.",
}

COMMENT_MAX_CHARS = 300

# Photo upload limits.
ALLOWED_PHOTO_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
MAX_PHOTO_BYTES = 3 * 1024 * 1024

# Customers can pick a pickup date from tomorrow up to this many days ahead.
PICKUP_MAX_DAYS_AHEAD = 5
PICKUP_SLOTS = ("Morning", "Afternoon", "Evening")
SLOT_HOURS = {"Morning": "9 - 12", "Afternoon": "12 - 4", "Evening": "4 - 8"}

# Staff members. There is no staff table in the spec, so they live here.
# The id is what gets stored in pickups.agent_id, qc_reports.inspector_id, etc.
STAFF = {
    "agent": [(1, "Ravi Kumar")],
    "qc": [(1, "Anjali Rao")],
    "refurbisher": [(1, "Farhan Sheikh")],
    "warehouse": [(1, "Kiran Patil")],
    "admin": [(1, "Deepa Nair")],
}

ROLES = ("customer", "agent", "qc", "refurbisher", "warehouse", "admin")

# Page each role lands on after switching.
ROLE_HOME = {
    "customer": "customer.orders",
    "agent": "agent.pickups",
    "qc": "qc.queue",
    "refurbisher": "refurbisher.jobs",
    "warehouse": "warehouse.receive",
    "admin": "admin.dashboard",
}
