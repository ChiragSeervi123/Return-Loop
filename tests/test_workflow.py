"""End-to-end checks of the return workflow through the service layer."""
from datetime import datetime, timedelta

import pytest

from models import InventoryLog, Refund
from services.returns import (WorkflowError, create_return, mark_absent,
                              mark_picked_up, mark_received, mark_repaired,
                              schedule_pickup, submit_inspection)
from services.state_machine import InvalidTransition

GOOD = dict(packaging_intact=True, tags_attached=True, item_matches_order=True, visible_damage=False)
TOMORROW = (datetime.now() + timedelta(days=1)).date()


def to_received(customer, item, reason="Not as described"):
    ret = create_return(customer, item, reason, "it wobbles")
    schedule_pickup(ret, TOMORROW, "Morning", customer.name)
    mark_picked_up(ret.current_pickup, "Ravi")
    mark_received(ret, "Kiran")
    return ret


def test_grade_b_full_journey(app, make):
    customer = make.customer()
    ret = to_received(customer, make.item(customer, price=2000))
    submit_inspection(ret, 1, GOOD, "B")
    assert ret.status == "Refurbishing"
    mark_repaired(ret.refurbish_jobs[0], "Farhan")
    assert ret.status == "Re-inspection"
    submit_inspection(ret, 1, GOOD, "B")
    assert ret.status == "Refunded"
    assert ret.refund.final_amount == 1400
    assert InventoryLog.query.one().action == "Refurbished"
    assert [h.to_status for h in ret.history] == [
        "Requested", "Pickup Scheduled", "Picked Up", "Received", "Inspected",
        "Refurbishing", "Re-inspection", "Restocked", "Refunded"]


def test_failed_recheck_becomes_grade_c(app, make):
    customer = make.customer()
    ret = to_received(customer, make.item(customer))
    submit_inspection(ret, 1, GOOD, "B")
    mark_repaired(ret.refurbish_jobs[0], "Farhan")
    submit_inspection(ret, 1, GOOD, "C")
    assert ret.status == "Refunded"
    assert ret.refund.final_amount == 0
    assert InventoryLog.query.one().action == "Scrapped"


def test_absent_twice_cancels(app, make):
    customer = make.customer()
    ret = create_return(customer, make.item(customer), "Damaged")
    schedule_pickup(ret, TOMORROW, "Evening", customer.name)
    mark_absent(ret.current_pickup, "Ravi")
    assert ret.status == "Pickup Scheduled" and len(ret.pickups) == 2
    mark_absent(ret.current_pickup, "Ravi")
    assert ret.status == "Cancelled"
    assert "absent" in ret.history[-1].note


def test_mismatched_item_is_rejected_as_fraud(app, make):
    customer = make.customer()
    ret = to_received(customer, make.item(customer))
    submit_inspection(ret, 1, dict(GOOD, item_matches_order=False), "A")
    assert ret.status == "Rejected" and ret.flagged_fraud
    assert Refund.query.count() == 0


def test_wrong_item_claim_is_not_fraud(app, make):
    customer = make.customer()
    ret = to_received(customer, make.item(customer, price=500), reason="Wrong item")
    submit_inspection(ret, 1, dict(GOOD, item_matches_order=False), "A")
    assert ret.status == "Refunded" and ret.refund.final_amount == 500


def test_double_submit_is_refused(app, make):
    customer = make.customer()
    ret = to_received(customer, make.item(customer))
    submit_inspection(ret, 1, GOOD, "A")
    with pytest.raises(WorkflowError):
        submit_inspection(ret, 1, GOOD, "A")
    assert Refund.query.count() == 1
    with pytest.raises(InvalidTransition):
        mark_received(ret, "Kiran")


def test_cannot_return_twice(app, make):
    customer = make.customer()
    item = make.item(customer)
    create_return(customer, item, "Damaged")
    with pytest.raises(WorkflowError):
        create_return(customer, item, "Damaged")


def test_pickup_date_must_be_in_range(app, make):
    customer = make.customer()
    ret = create_return(customer, make.item(customer), "Damaged")
    with pytest.raises(WorkflowError):
        schedule_pickup(ret, datetime.now().date(), "Morning", customer.name)
    with pytest.raises(WorkflowError):
        schedule_pickup(ret, TOMORROW + timedelta(days=5), "Morning", customer.name)
