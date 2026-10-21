"""Smoke tests: every page renders for its role, and the customer flow works over HTTP."""
import io
from datetime import datetime, timedelta

import pytest

import seed
from conftest import login
from models import ReturnRequest

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


@pytest.fixture
def seeded(app):
    customers, items = seed.build_catalogue()
    seed.seed_returns(customers, items)
    return customers, items


def test_landing_and_switch(client, seeded):
    assert client.get("/").status_code == 200
    assert client.get("/switch").status_code == 200
    res = client.post("/switch", data={"who": "qc:1"})
    assert res.status_code == 302 and res.location.endswith("/qc/queue")


def test_bad_switch_is_ignored(client, seeded):
    client.post("/switch", data={"who": "admin:99"})
    assert client.get("/admin/dashboard").status_code == 403


def test_wrong_role_gets_friendly_403(client, seeded):
    login(client, "customer", 1)
    res = client.get("/qc/queue")
    assert res.status_code == 403
    assert b"Staff only" in res.data


def test_customer_pages_render(client, seeded):
    login(client, "customer", 1)
    for url in ["/customer/orders", "/customer/returns", "/customer/return/RL-2026-0001",
                "/customer/return/RL-2026-0002", "/customer/return/RL-2026-0002/schedule"]:
        assert client.get(url).status_code == 200, url


def test_other_customers_return_is_404(client, seeded):
    login(client, "customer", 1)
    assert client.get("/customer/return/RL-2026-0003").status_code == 404
    assert client.get("/customer/return/RL-9999-0001").status_code == 404


def test_customer_return_flow_over_http(client, seeded):
    customers, items = seeded
    login(client, "customer", customers[0].id)
    lamp = items[0][0]

    res = client.post(f"/customer/return/new?item={lamp.id}", data={
        "reason": "Damaged", "comment": "Shade dented.",
        "photo": (io.BytesIO(PNG), "dent.png"),
    }, content_type="multipart/form-data")
    assert res.status_code == 302
    ret = ReturnRequest.query.filter_by(order_item_id=lamp.id).one()
    assert ret.photo_path.startswith("uploads/")

    # a second attempt on the same item is refused
    res = client.post(f"/customer/return/new?item={lamp.id}", data={"reason": "Damaged"})
    assert res.status_code == 400

    tomorrow = (datetime.now() + timedelta(days=1)).date().isoformat()
    res = client.post(f"/customer/return/{ret.return_code}/schedule",
                      data={"slot_date": tomorrow, "slot_window": "Evening"})
    assert res.status_code == 302
    assert ret.status == "Pickup Scheduled"

    data = client.get(f"/api/return/{ret.return_code}/status").get_json()
    assert data["step"] == 1


def test_bad_upload_is_refused(client, seeded):
    customers, items = seeded
    login(client, "customer", customers[0].id)
    res = client.post(f"/customer/return/new?item={items[0][1].id}", data={
        "reason": "Damaged", "photo": (io.BytesIO(b"%PDF-1.4"), "doc.pdf"),
    }, content_type="multipart/form-data")
    assert res.status_code == 400
    assert b"PNG, JPG or WEBP" in res.data
    assert ReturnRequest.query.filter_by(order_item_id=items[0][1].id).count() == 0


def test_ineligible_item_has_no_return_button(client, seeded):
    customers, items = seeded
    login(client, "customer", customers[0].id)
    page = client.get("/customer/orders").data.decode()
    assert "Not returnable" in page      # earbuds
    res = client.post(f"/customer/return/new?item={items[3][0].id}", data={"reason": "Damaged"})
    assert res.status_code == 400
