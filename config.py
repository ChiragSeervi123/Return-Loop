"""App configuration and every business rule constant in one place.

If a number changes (return window, fee, refund percentage), change it here only.
"""
import os
import tempfile

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

# On Vercel the project folder is read-only; only /tmp can be written.
ON_VERCEL = bool(os.environ.get("VERCEL"))
DATA_DIR = "/tmp" if ON_VERCEL else BASE_DIR


def database_url():
    """Where the data lives. A Postgres database connected in Vercel (Neon) sets these
    variables, so every instance of the app shares it. Without one: a SQLite file.

    The direct (unpooled) address comes first: the demo-data rebuild relies on Postgres
    advisory locks, which a transaction pooler doesn't keep."""
    url = next((os.environ[k] for k in ("DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING",
                                        "DATABASE_URL", "POSTGRES_URL") if os.environ.get(k)), None)
    if url is None:   # connected with a custom prefix: any Postgres address will do, unpooled first
        found = sorted((("UNPOOLED" not in k and "NON_POOLING" not in k), k) for k, v in os.environ.items()
                       if v.startswith(("postgres://", "postgresql://")))
        url = os.environ[found[0][1]] if found else None
    if url is None:
        return "sqlite:///" + os.path.join(DATA_DIR, "returnloop.db")
    # SQLAlchemy only knows the postgresql:// spelling
    return "postgresql://" + url[len("postgres://"):] if url.startswith("postgres://") else url


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "returnloop-dev-secret")
    SQLALCHEMY_DATABASE_URI = database_url()
    # A hosted database closes idle connections; test each one before use, renew every few minutes.
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True, "pool_recycle": 280}
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    UPLOAD_FOLDER = (os.path.join(DATA_DIR, "uploads") if ON_VERCEL
                     else os.path.join(BASE_DIR, "static", "uploads"))
    # Flask rejects any request body above this with a 413. We set it a little
    # above MAX_PHOTO_BYTES so the friendly "photo too large" check can run first.
    MAX_CONTENT_LENGTH = 4 * 1024 * 1024
    TESTING = False


class TestConfig(Config):
    # TEST_DATABASE_URL runs the suite against another database, e.g. a local Postgres.
    SQLALCHEMY_DATABASE_URI = os.environ.get("TEST_DATABASE_URL", "sqlite:///:memory:")
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
    "agent": [(1, "Ayush Dubey")],
    "qc": [(1, "Aadi Srivastava")],
    "refurbisher": [(1, "Anumeet")],
    "warehouse": [(1, "Ansuman Singh")],
    "admin": [(1, "Aryan Singh")],
}

# In the order a return travels, so the role menu follows the process.
ROLES = ("customer", "agent", "warehouse", "qc", "refurbisher", "admin")

ROLE_LABELS = {
    "customer": "Customer",
    "agent": "Pickup agent",
    "warehouse": "Warehouse",
    "qc": "QC inspector",
    "refurbisher": "Refurbisher",
    "admin": "Admin",
}

# Page each role lands on after switching.
ROLE_HOME = {
    "customer": "customer.orders",
    "agent": "agent.pickups",
    "qc": "qc.queue",
    "refurbisher": "refurbisher.jobs",
    "warehouse": "warehouse.receive",
    "admin": "admin.dashboard",
}

# The team page (/team). Edit names or roles here; the page and its 3D scene read this list.
# "accent" picks the stamp colour: a = moss, b = amber, c = brick, d = orange.
TEAM = [
    {"name": "Chirag Seervi", "role": "Co-creator, ReturnLoop", "accent": "a"},
    {"name": "Anshuman Singh", "role": "Co-creator, ReturnLoop", "accent": "b"},
    {"name": "Aryan Singh", "role": "Co-creator, ReturnLoop", "accent": "c"},
    {"name": "Aadi Srivastava", "role": "Co-creator, ReturnLoop", "accent": "d"},
]

# Where the app is deployed; the documentation cover links to it.
PUBLIC_URL = os.environ.get("PUBLIC_URL", "https://return-loop.vercel.app")

# The maker's page (/maker), opened from the stamp on the landing page. Edit details here.
MAKER = {
    "name": "Chirag Seervi",
    "initials": "CS",
    "institute": "SVKM's NMIMS",
    "campus": "Hyderabad",
    "degree": "B.Tech",
    "programme": "Computer Science and Engineering (Data Science)",
    "division": "A",
    "batch": "2025 – 2029",
    "sap_id": "70572500055",
    "roll_no": "A055",
}
