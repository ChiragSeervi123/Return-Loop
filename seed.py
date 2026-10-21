"""Fill the database with demo data:  python seed.py

Returns are pushed through the real service functions (so every history row,
refund and inventory entry is consistent), then their timestamps are moved
into the past so the timelines look like real life.
"""
from datetime import datetime, timedelta

from app import create_app
from models import (Customer, InventoryLog, Order, OrderItem, Product,
                    ReturnRequest, db)
from services.returns import (close_return, create_return, mark_picked_up, mark_received,
                              mark_repaired, schedule_pickup, submit_inspection)

NOW = datetime.now().replace(second=0, microsecond=0)

CUSTOMERS = [
    ("Asha Menon", "asha@example.com", "98201 44120", "Flat 4B, Sea Breeze, Bandra West, Mumbai 400050"),
    ("Rohan Verma", "rohan@example.com", "99100 23871", "221 Sector 15, Rohini, Delhi 110089"),
    ("Priya Shah", "priya@example.com", "97234 66510", "17 Lake View Road, Koramangala, Bengaluru 560034"),
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

# customer index, days since delivery, [(product index, quantity)]
ORDERS = [
    (0, 2, [(0, 1), (1, 1)]),
    (0, 5, [(2, 1)]),
    (0, 10, [(3, 1)]),
    (0, 13, [(4, 1)]),
    (1, 3, [(5, 1)]),
    (1, 6, [(6, 1), (7, 1)]),
    (1, 9, [(8, 1)]),
    (1, 12, [(2, 1)]),
    (2, 1, [(9, 1), (1, 1)]),
    (2, 4, [(7, 1)]),
    (2, 8, [(1, 3)]),
    (2, 14, [(8, 2)]),
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
    for cust_i, days, lines in ORDERS:
        delivered = (NOW - timedelta(days=days)).replace(hour=14, minute=20)
        order = Order(customer_id=customers[cust_i].id, order_date=delivered - timedelta(days=3),
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
            mark_picked_up(ret.current_pickup, "Ravi Kumar", "Sealed box, label attached.")
        elif step == "receive":
            mark_received(ret, "Kiran Patil")
    return ret


def seed_returns(customers, items):
    asha, rohan, priya = customers

    # 1. Asha: backpack, grade B, repaired, passed recheck, refunded and closed.
    r = make_return(asha, items[2][0], "Not as described", "Zip pull is a different colour from the photos.",
                    day(8), "receive")
    submit_inspection(r, 1, dict(GOOD, tags_attached=False), "B", "Zip pull swapped, tags missing.")
    mark_repaired(r.refurbish_jobs[0], "Farhan Sheikh", "Replaced zip pull, steam cleaned.")
    submit_inspection(r, 1, GOOD, "B", "Repair holds. Good to sell as refurbished.")
    close_return(r, asha.name)
    backdate(r, day(8, 11))

    # 2. Asha: headphones, pickup booked for today (shows on the agent's list).
    r = create_return(asha, items[1][0], "Damaged", "Left ear cup rattles. Hinge cracked out of the box.",
                      today=day(1, 18))
    schedule_pickup(r, NOW.date(), "Morning", asha.name, today=day(1, 18))
    backdate(r, day(1, 18), gap_hours=1)

    # 3-6. Rohan: four returns in the last 30 days, so the admin sees a flag.
    r = make_return(rohan, items[4][0], "Changed my mind", "Bought a bigger one.", day(1, 9), None)
    backdate(r, day(1, 9))

    r = make_return(rohan, items[5][0], "Not as described", "Not waterproof. Soaked through in light rain.",
                    day(4), "pickup")
    backdate(r, day(4, 12), gap_hours=26)

    r = make_return(rohan, items[6][0], "Damaged", "Speaker grille dented on arrival.", day(7), "receive")
    backdate(r, day(7, 16), gap_hours=30)

    r = make_return(rohan, items[7][0], "Changed my mind", "Prefer the black ones.", day(10), "receive")
    submit_inspection(r, 1, dict(GOOD, packaging_intact=False), "B", "Box crushed, earcup scuffed.")
    backdate(r, day(10, 10), gap_hours=30)

    # 7. Priya: mugs, wrong item sent, grade A, full refund.
    r = make_return(priya, items[10][0], "Wrong item", "Got the blue glaze set, ordered the sand one.",
                    day(6), "receive")
    submit_inspection(r, 1, dict(GOOD, item_matches_order=False), "A", "Blue set received. Unused, restock.")
    backdate(r, day(6, 9), gap_hours=22)

    # 8. Priya: speakers, damage confirmed, grade C, still a full refund (damaged exception).
    r = make_return(priya, items[11][0], "Damaged", "One unit doesn't power on at all.", day(12), "receive")
    submit_inspection(r, 1, dict(GOOD, visible_damage=True, packaging_intact=False), "C",
                      "Board burnt. Not worth repairing.")
    backdate(r, day(12, 13), gap_hours=30)

    # 9. Priya: sneakers, repaired and now waiting for re-inspection.
    r = make_return(priya, items[9][0], "Not as described", "Sole is stitched, listing said glued.",
                    day(3), "receive")
    submit_inspection(r, 1, dict(GOOD, visible_damage=True), "B", "Toe scuffed. Send for cleaning.")
    mark_repaired(r.refurbish_jobs[0], "Farhan Sheikh", "Cleaned and re-laced.")
    backdate(r, day(3, 8), gap_hours=10)


def main():
    app = create_app()
    with app.app_context():
        db.drop_all()
        db.create_all()
        customers, items = build_catalogue()
        seed_returns(customers, items)
        print(f"Seeded {Customer.query.count()} customers, {Product.query.count()} products, "
              f"{Order.query.count()} orders, {ReturnRequest.query.count()} returns.")
        for ret in ReturnRequest.query.order_by(ReturnRequest.id):
            print(f"  {ret.return_code}  {ret.customer.name:<12} {ret.status}")


if __name__ == "__main__":
    main()
