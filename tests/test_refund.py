import pytest

from models import InventoryLog, QCReport, Refund, db
from services.refund import RefundError, calculate_refund, issue_refund


def report(**kw):
    defaults = dict(packaging_intact=True, tags_attached=True,
                    item_matches_order=True, visible_damage=False)
    defaults.update(kw)
    return QCReport(inspector_id=1, **defaults)


def test_grade_a_full_refund():
    r = calculate_refund(1000, "A", "Not as described", report())
    assert r == {"base_amount": 1000, "grade_percent": 100, "pickup_fee": 0, "final_amount": 1000}


def test_grade_b_seventy_percent():
    assert calculate_refund(1000, "B", "Not as described", report())["final_amount"] == 700


def test_grade_c_nothing():
    assert calculate_refund(1000, "C", "Not as described", report())["final_amount"] == 0


def test_damaged_exception_gives_full_refund_regardless_of_grade():
    r = calculate_refund(1000, "C", "Damaged", report(visible_damage=True))
    assert r["grade_percent"] == 100 and r["final_amount"] == 1000


def test_damaged_claim_not_confirmed_uses_grade():
    assert calculate_refund(1000, "B", "Damaged", report(visible_damage=False))["final_amount"] == 700


def test_wrong_item_exception():
    r = calculate_refund(800, "B", "Wrong item", report(item_matches_order=False))
    assert r["final_amount"] == 800


def test_pickup_fee_for_changed_mind():
    r = calculate_refund(1000, "A", "Changed my mind", report())
    assert r["pickup_fee"] == 50 and r["final_amount"] == 950


def test_no_pickup_fee_for_other_reasons():
    assert calculate_refund(1000, "A", "Damaged", report())["pickup_fee"] == 0


def test_floor_at_zero():
    r = calculate_refund(1000, "C", "Changed my mind", report())
    assert r["final_amount"] == 0
    r = calculate_refund(30, "A", "Changed my mind", report())
    assert r["final_amount"] == 0


def test_issue_refund_writes_refund_and_inventory_together(app, make):
    customer = make.customer()
    ret = make.ret(customer, status="Restocked", reason="Not as described")
    db.session.add(QCReport(return_id=ret.id, inspector_id=1, grade="A"))
    db.session.commit()

    issue_refund(ret, "qc", "Tester", "Restocked")

    assert ret.status == "Refunded"
    assert Refund.query.count() == 1
    assert InventoryLog.query.one().action == "Restocked"


def test_refund_never_created_twice(app, make):
    ret = make.ret(make.customer(), status="Restocked", reason="Not as described")
    db.session.add(QCReport(return_id=ret.id, inspector_id=1, grade="A"))
    db.session.commit()
    issue_refund(ret, "qc", "Tester", "Restocked")
    with pytest.raises(RefundError):
        issue_refund(ret, "qc", "Tester", "Restocked")
    assert Refund.query.count() == 1
    assert InventoryLog.query.count() == 1
