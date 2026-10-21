"""Shared test setup: a fresh in-memory database and small helpers to build data."""
import os
import sys
from datetime import datetime, timedelta

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app  # noqa: E402
from config import TestConfig  # noqa: E402
from models import Customer, Order, OrderItem, Product, ReturnRequest, db  # noqa: E402


@pytest.fixture
def app():
    app = create_app(TestConfig)
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def make():
    """Factory helpers so each test can build just the data it needs."""
    class Maker:
        count = 0

        def customer(self, name="Asha"):
            Maker.count += 1
            c = Customer(name=name, email=f"{name.lower()}{Maker.count}@example.com",
                         phone="9800000000", address="12 MG Road, Pune")
            db.session.add(c)
            db.session.commit()
            return c

        def item(self, customer, days_ago=2, price=1000.0, returnable=True, quantity=1):
            product = Product(name="Desk Lamp", category="Home", price=price,
                              is_returnable=returnable)
            delivered = datetime.now() - timedelta(days=days_ago)
            order = Order(customer_id=customer.id, order_date=delivered - timedelta(days=3),
                          delivered_at=delivered, total=price * quantity)
            db.session.add_all([product, order])
            db.session.flush()
            item = OrderItem(order_id=order.id, product_id=product.id,
                             quantity=quantity, unit_price=price)
            db.session.add(item)
            db.session.commit()
            return item

        def ret(self, customer, item=None, status="Requested", reason="Damaged",
                created_at=None):
            item = item or self.item(customer)
            Maker.count += 1
            r = ReturnRequest(return_code=f"RL-TEST-{Maker.count:04d}", order_item_id=item.id,
                              customer_id=customer.id, reason=reason, status=status,
                              created_at=created_at or datetime.now())
            db.session.add(r)
            db.session.commit()
            return r

    return Maker()


def login(client, role, user_id):
    with client.session_transaction() as s:
        s["role"] = role
        s["user_id"] = user_id
