"""Refund maths and refund creation."""
from config import (FULL_REFUND_REASONS, GRADE_REFUND_PERCENT, PICKUP_FEE,
                    PICKUP_FEE_REASONS)
from models import InventoryLog, Refund, db
from services.state_machine import (REFUNDED, RESTOCKED, SCRAPPED,
                                    change_status)


class RefundError(Exception):
    pass


def inr(amount):
    """₹ with Indian digit grouping: 123456 -> ₹1,23,456. Paise only when there are some."""
    whole, paise = divmod(round(float(amount or 0) * 100), 100)
    digits = str(int(whole))
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        digits = ",".join(([head] if head else []) + groups) + "," + tail
    return f"₹{digits}" + (f".{paise:02d}" if paise else "")


def claim_confirmed(reason, report):
    """Did QC confirm the customer's complaint? (the full-refund exception)"""
    if report is None:
        return False
    if reason == "Damaged":
        return bool(report.visible_damage)
    if reason == "Wrong item":
        return not report.item_matches_order
    return False


def calculate_refund(base_amount, grade, reason, report=None):
    """Work out every part of the refund.

    final = max(0, base * grade_percent - pickup_fee)
    Returns a dict so the page can show the full breakdown.
    """
    if reason in FULL_REFUND_REASONS and claim_confirmed(reason, report):
        percent = 100
    else:
        percent = GRADE_REFUND_PERCENT[grade]

    fee = PICKUP_FEE if reason in PICKUP_FEE_REASONS else 0
    final = max(0, round(base_amount * percent / 100 - fee, 2))
    return {
        "base_amount": round(base_amount, 2),
        "grade_percent": percent,
        "pickup_fee": fee,
        "final_amount": final,
    }


def final_grade(ret):
    """Grade that decides the refund: the latest QC report's grade."""
    report = ret.latest_report
    return report.grade if report else None


def issue_refund(ret, actor_role, actor_name, inventory_action):
    """Create the refund AND the inventory_log row, then move to Refunded.

    All three writes are committed together: either everything is saved or
    nothing is. A return can never be refunded twice.
    """
    if ret.refund is not None:
        raise RefundError(f"{ret.return_code} already has a refund.")
    if ret.status not in (RESTOCKED, SCRAPPED):
        raise RefundError(f"{ret.return_code} is '{ret.status}', not ready for a refund.")

    item = ret.order_item
    parts = calculate_refund(item.unit_price * item.quantity, final_grade(ret),
                             ret.reason, ret.first_report)
    try:
        refund = Refund(return_id=ret.id, status="Credited", **parts)
        db.session.add(refund)
        db.session.add(InventoryLog(product_id=item.product_id, return_id=ret.id,
                                    action=inventory_action, quantity=item.quantity))
        ret.refund_status = "Credited"
        note = f"Refund of {inr(parts['final_amount'])} credited."
        change_status(ret, REFUNDED, actor_role, actor_name, note, commit=False)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return refund
