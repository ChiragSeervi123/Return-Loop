"""Fill the database with demo data:  python seed.py

Returns are pushed through the real service functions (so every history row,
refund and inventory entry is consistent), then their timestamps are moved
into the past so the timelines look like real life.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta

from app import create_app
from models import (Customer, InventoryLog, Order, OrderItem, Product,
                    ReturnRequest, db)
from services.returns import (close_return, create_return, mark_picked_up, mark_received,
                              mark_repaired, schedule_pickup, submit_inspection)

NOW = datetime.now().replace(second=0, microsecond=0)   # fill() moves it to the moment it runs

# Postgres advisory-lock key for rebuilding the demo data (any fixed number).
REBUILD_LOCK = 4_204_242

# One demo customer, so every return in the demo belongs to the same person.
CUSTOMERS = [
    ("Chirag", "chirag@example.com", "98201 44120", "Flat 4B, Sea Breeze, Bandra West, Mumbai 400050"),
]

# name, category, price, returnable
PRODUCTS = [
    ("Brass Desk Lamp", "Home", 2499, True),
    ("Stoneware Mug, set of 3", "Kitchen", 899, True),
    ("Over-ear Headphones", "Audio", 5999, True),
    ("Canvas Backpack", "Bags", 1799, True),
    ("In-ear Earbuds", "Audio", 1299, False),   # hygiene: not returnable
    ("Electric Kettle 1.5L", "Kitchen", 1499, True),
    ("Rain Jacket", "Apparel", 3299, True),
    ("Running Sneakers", "Footwear", 4199, True),
    ("Bluetooth Speaker", "Audio", 2799, True),
    ("Vitamin C Face Serum", "Beauty", 649, False),  # hygiene: not returnable
]

# days since delivery, [(product index, quantity)]
ORDERS = [
    (2, [(0, 1), (1, 1)]),
    (5, [(2, 1)]),
    (10, [(3, 1)]),
    (13, [(4, 1)]),
    (3, [(5, 1)]),
    (6, [(6, 1), (7, 1)]),
    (9, [(8, 1)]),
    (12, [(2, 1)]),
    (1, [(9, 1), (1, 1)]),
    (4, [(7, 1)]),
    (8, [(1, 3)]),
    (14, [(8, 2)]),
]

GOOD = dict(packaging_intact=True, tags_attached=True, item_matches_order=True, visible_damage=False)


def build_catalogue():
    customers = []
    for i, (name, email, phone, address) in enumerate(CUSTOMERS):
        c = Customer(name=name, email=email, phone=phone, address=address,
                     created_at=NOW - timedelta(days=200 - i * 40))
        customers.append(c)
    products = [Product(name=n, category=cat, price=p, is_returnable=r,
                        image_url=f"placeholder:{cat.lower()}")
                for i, (n, cat, p, r) in enumerate(PRODUCTS)]
    db.session.add_all(customers + products)
    db.session.flush()

    items = []  # items[order_no][line_no]
    for days, lines in ORDERS:
        delivered = (NOW - timedelta(days=days)).replace(hour=14, minute=20)
        order = Order(customer_id=customers[0].id, order_date=delivered - timedelta(days=3),
                      delivered_at=delivered,
                      total=sum(products[p].price * q for p, q in lines))
        db.session.add(order)
        db.session.flush()
        row = []
        for p, q in lines:
            item = OrderItem(order_id=order.id, product_id=products[p].id,
                             quantity=q, unit_price=products[p].price)
            db.session.add(item)
            row.append(item)
        items.append(row)
    db.session.commit()
    return customers, items


def day(n_ago, hour=10):
    return (NOW - timedelta(days=n_ago)).replace(hour=hour, minute=0)


def backdate(ret, start, gap_hours=20):
    """Spread this return's history from `start`, one step every gap_hours."""
    moments = [start + timedelta(hours=gap_hours * i) for i in range(len(ret.history))]
    moments = [min(m, NOW - timedelta(minutes=30)) for m in moments]
    for row, when in zip(ret.history, moments):
        row.created_at = when
        if row.to_status == "Picked Up":
            ret.current_pickup.slot_date = when.date()
    ret.created_at, ret.updated_at = moments[0], moments[-1]
    for report in ret.qc_reports:
        report.created_at = moments[min(len(moments) - 1, 4)]
    for job in ret.refurbish_jobs:
        job.created_at = moments[min(len(moments) - 1, 5)]
        if job.completed_at:
            job.completed_at = moments[min(len(moments) - 1, 6)]
    if ret.refund:
        ret.refund.created_at = moments[-1]
    for log in InventoryLog.query.filter_by(return_id=ret.id):
        log.created_at = moments[-1]
    db.session.commit()


def make_return(customer, item, reason, comment, created, until):
    """Create a return on `created` and move it along the flow up to `until`."""
    ret = create_return(customer, item, reason, comment, today=created)
    steps = ["schedule", "pickup", "receive", "inspect", "repair", "recheck"]
    for step in steps[: steps.index(until) + 1] if until else []:
        if step == "schedule":
            schedule_pickup(ret, created.date() + timedelta(days=1), "Morning", customer.name,
                            today=created)
        elif step == "pickup":
            mark_picked_up(ret.current_pickup, "Ayush Dubey", "Sealed box, label attached.")
        elif step == "receive":
            mark_received(ret, "Ansuman Singh")
    return ret


def seed_returns(customers, items):
    """Only finished returns, so the staff queues start empty.

    They show up in the customer's "My returns" history and give the admin
    charts and warehouse inventory something to draw. Every new return the
    customer makes then travels Agent -> Warehouse -> QC -> Refurbisher.
    """
    asha = customers[0]

    # 1. Backpack: grade B, repaired, passed recheck, refunded and closed.
    r = make_return(asha, items[2][0], "Not as described", "Zip pull is a different colour from the photos.",
                    day(8), "receive")
    submit_inspection(r, 1, dict(GOOD, tags_attached=False), "B", "Zip pull swapped, tags missing.")
    mark_repaired(r.refurbish_jobs[0], "Anumeet", "Replaced zip pull, steam cleaned.")
    submit_inspection(r, 1, GOOD, "B", "Repair holds. Good to sell as refurbished.")
    close_return(r, asha.name)
    backdate(r, day(8, 11))

    # 2. Mugs: wrong item sent, grade A, full refund.
    r = make_return(asha, items[10][0], "Wrong item", "Got the blue glaze set, ordered the sand one.",
                    day(6), "receive")
    submit_inspection(r, 1, dict(GOOD, item_matches_order=False), "A", "Blue set received. Unused, restock.")
    backdate(r, day(6, 9), gap_hours=22)

    # 3. Speakers: damage confirmed, grade C, still a full refund (damaged exception).
    r = make_return(asha, items[11][0], "Damaged", "One unit doesn't power on at all.", day(12), "receive")
    submit_inspection(r, 1, dict(GOOD, visible_damage=True, packaging_intact=False), "C",
                      "Board burnt. Not worth repairing.")
    backdate(r, day(12, 13), gap_hours=30)


def fill():
    """Drop every table and rebuild the demo data, dated from this moment. Needs an app context."""
    global NOW
    NOW = datetime.now().replace(second=0, microsecond=0)
    db.session.remove()   # an open transaction would block DROP TABLE on Postgres
    db.drop_all()
    db.create_all()
    customers, items = build_catalogue()
    seed_returns(customers, items)


@contextmanager
def rebuild_lock():
    """With a shared Postgres, several app instances can start at once: one rebuilds at a time."""
    if db.engine.dialect.name != "postgresql":
        yield
        return
    with db.engine.connect() as conn:
        conn.execute(db.text("SELECT pg_advisory_lock(:key)"), {"key": REBUILD_LOCK})
        try:
            yield
        finally:
            conn.execute(db.text("SELECT pg_advisory_unlock(:key)"), {"key": REBUILD_LOCK})


def fill_if_empty():
    """A database with no tables (a new Vercel instance's /tmp, a newly connected Postgres): fill it."""
    with rebuild_lock():
        if not db.inspect(db.engine).has_table("customers"):
            fill()


def main():
    app = create_app()
    with app.app_context():
        fill()
        print(f"Seeded {Customer.query.count()} customers, {Product.query.count()} products, "
              f"{Order.query.count()} orders, {ReturnRequest.query.count()} returns.")
        for ret in ReturnRequest.query.order_by(ReturnRequest.id):
            print(f"  {ret.return_code}  {ret.customer.name:<12} {ret.status}")


if __name__ == "__main__":
    main()
