import pytest

from models import StatusHistory
from services.state_machine import (ALL_STATUSES, TRANSITIONS, InvalidTransition,
                                    change_status, step_index)

VALID = [(src, dst) for src, targets in TRANSITIONS.items() for dst in sorted(targets)]

INVALID = [
    ("Requested", "Picked Up"),        # skipping the pickup booking
    ("Requested", "Refunded"),         # refund without any inspection
    ("Picked Up", "Inspected"),        # skipping warehouse check-in
    ("Received", "Restocked"),         # skipping the QC grade
    ("Refurbishing", "Restocked"),     # skipping re-inspection
    ("Closed", "Requested"),           # reopening a finished return
    ("Cancelled", "Pickup Scheduled"), # reviving a cancelled return
    ("Refunded", "Refunded"),          # refunding twice
    ("Rejected", "Inspected"),
]


def test_transition_table_covers_every_status():
    assert set(TRANSITIONS) == set(ALL_STATUSES)


@pytest.mark.parametrize("src,dst", VALID)
def test_every_valid_transition_passes(app, make, src, dst):
    ret = make.ret(make.customer(), status=src)
    change_status(ret, dst, "qc", "Tester", "note")
    assert ret.status == dst
    row = StatusHistory.query.filter_by(return_id=ret.id).one()
    assert (row.from_status, row.to_status, row.actor_name) == (src, dst, "Tester")


@pytest.mark.parametrize("src,dst", INVALID)
def test_invalid_transitions_fail(app, make, src, dst):
    ret = make.ret(make.customer(), status=src)
    with pytest.raises(InvalidTransition):
        change_status(ret, dst, "qc", "Tester")
    assert ret.status == src
    assert StatusHistory.query.count() == 0


def test_change_updates_timestamp(app, make):
    ret = make.ret(make.customer())
    before = ret.updated_at
    change_status(ret, "Pickup Scheduled", "customer", "Asha")
    assert ret.updated_at >= before


def test_rejected_return_keeps_its_last_step(app, make):
    ret = make.ret(make.customer(), status="Received")
    change_status(ret, "Rejected", "qc", "Tester")
    assert step_index(ret) == 3
