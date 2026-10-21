"""The return status state machine.

Every status change in the app goes through change_status(). It:
  1. checks the move is allowed (TRANSITIONS below),
  2. writes a status_history row,
  3. updates updated_at,
all in one database transaction.
"""
from models import StatusHistory, db, now

REQUESTED = "Requested"
PICKUP_SCHEDULED = "Pickup Scheduled"
PICKED_UP = "Picked Up"
RECEIVED = "Received"
INSPECTED = "Inspected"
REFURBISHING = "Refurbishing"
REINSPECTION = "Re-inspection"
RESTOCKED = "Restocked"
SCRAPPED = "Scrapped"
REFUNDED = "Refunded"
CLOSED = "Closed"
REJECTED = "Rejected"
CANCELLED = "Cancelled"

ALL_STATUSES = [
    REQUESTED, PICKUP_SCHEDULED, PICKED_UP, RECEIVED, INSPECTED, REFURBISHING,
    REINSPECTION, RESTOCKED, SCRAPPED, REFUNDED, CLOSED, REJECTED, CANCELLED,
]

# status -> set of statuses it may move to. Anything not listed is invalid.
TRANSITIONS = {
    REQUESTED: {PICKUP_SCHEDULED, REJECTED},
    PICKUP_SCHEDULED: {PICKED_UP, PICKUP_SCHEDULED, CANCELLED},
    PICKED_UP: {RECEIVED},
    RECEIVED: {INSPECTED, REJECTED},
    INSPECTED: {RESTOCKED, REFURBISHING, SCRAPPED},
    REFURBISHING: {REINSPECTION},
    REINSPECTION: {RESTOCKED, SCRAPPED},
    RESTOCKED: {REFUNDED},
    SCRAPPED: {REFUNDED},
    REFUNDED: {CLOSED},
    CLOSED: set(),
    REJECTED: set(),
    CANCELLED: set(),
}

# Statuses where the return is finished (no more moves possible).
TERMINAL = {CLOSED, REJECTED, CANCELLED}

# The six steps shown on the tracking page. Each status maps to a step index.
TRACK_STEPS = ["Requested", "Scheduled", "Picked up", "Received", "Graded", "Refunded"]
STEP_OF_STATUS = {
    REQUESTED: 0,
    PICKUP_SCHEDULED: 1,
    PICKED_UP: 2,
    RECEIVED: 3,
    INSPECTED: 4,
    REFURBISHING: 4,
    REINSPECTION: 4,
    RESTOCKED: 4,
    SCRAPPED: 4,
    REFUNDED: 5,
    CLOSED: 5,
}


class InvalidTransition(Exception):
    """Raised when someone tries a status move that the flow does not allow."""


def can_change(current, new_status):
    return new_status in TRANSITIONS.get(current, set())


def change_status(ret, new_status, actor_role, actor_name, note="", commit=True):
    """Move a return to new_status, or raise InvalidTransition.

    commit=False lets a caller group this change with other writes (for
    example the refund) and commit everything together as one transaction.
    """
    if not can_change(ret.status, new_status):
        raise InvalidTransition(
            f"A return that is '{ret.status}' cannot move to '{new_status}'."
        )
    try:
        db.session.add(StatusHistory(
            return_id=ret.id,
            from_status=ret.status,
            to_status=new_status,
            actor_role=actor_role,
            actor_name=actor_name,
            note=note,
        ))
        ret.status = new_status
        ret.updated_at = now()
        if commit:
            db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return ret


def step_index(ret):
    """Which tracking step a return is on.

    Rejected / Cancelled returns stay on the last step they actually reached,
    found by looking back through their history.
    """
    if ret.status in STEP_OF_STATUS:
        return STEP_OF_STATUS[ret.status]
    reached = [STEP_OF_STATUS[h.from_status] for h in ret.history if h.from_status in STEP_OF_STATUS]
    return max(reached) if reached else 0
