"""Can this order item be returned? Returns (ok, reason) so the UI can explain why not."""
from datetime import timedelta

from config import RETURN_WINDOW_DAYS
from models import now
from services.state_machine import CANCELLED, TERMINAL


def window_closes_at(order_item):
    delivered = order_item.order.delivered_at
    return delivered + timedelta(days=RETURN_WINDOW_DAYS) if delivered else None


def days_left(order_item, today=None):
    closes = window_closes_at(order_item)
    if closes is None:
        return 0
    today = today or now()
    return max(0, (closes.date() - today.date()).days)


def existing_return(order_item):
    """Any earlier return for this item that still counts (cancelled ones do not)."""
    for ret in order_item.returns:
        if ret.status != CANCELLED:
            return ret
    return None


def check_eligibility(order_item, today=None):
    """Return (True, "") if the item can be returned, else (False, short reason)."""
    today = today or now()

    if order_item.order.delivered_at is None:
        return False, "Not delivered yet"
    if not order_item.product.is_returnable:
        return False, "Not returnable"
    # Whole days: delivered on the 1st means returns are open until the end of the 8th.
    if today.date() > window_closes_at(order_item).date():
        return False, "Window closed"

    earlier = existing_return(order_item)
    if earlier is not None:
        if earlier.status in TERMINAL:
            return False, "Already returned"
        return False, "Return already open"

    return True, ""
