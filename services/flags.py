"""Frequent-returner flag. It is only shown to the admin; it never blocks anyone."""
from datetime import timedelta

from config import FREQUENT_RETURN_DAYS, FREQUENT_RETURN_LIMIT
from models import Customer, ReturnRequest, now


def recent_return_count(customer_id, today=None):
    since = (today or now()) - timedelta(days=FREQUENT_RETURN_DAYS)
    return ReturnRequest.query.filter(
        ReturnRequest.customer_id == customer_id,
        ReturnRequest.created_at >= since,
    ).count()


def is_frequent_returner(customer_id, today=None):
    return recent_return_count(customer_id, today) > FREQUENT_RETURN_LIMIT


def flagged_customers(today=None):
    """List of (customer, count) for everyone over the limit."""
    result = []
    for customer in Customer.query.order_by(Customer.name).all():
        count = recent_return_count(customer.id, today)
        if count > FREQUENT_RETURN_LIMIT:
            result.append((customer, count))
    return result
