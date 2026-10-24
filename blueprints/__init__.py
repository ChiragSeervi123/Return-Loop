"""Helpers shared by every blueprint: who is using the app, and role checks."""
from flask import abort, session

from config import STAFF
from models import Customer, db


def current_role():
    return session.get("role")


def current_user_id():
    return session.get("user_id")


def current_customer():
    if current_role() != "customer":
        return None
    return db.session.get(Customer, current_user_id())


def current_user_name():
    role, uid = current_role(), current_user_id()
    if role == "customer":
        customer = current_customer()
        return customer.name if customer else "Guest"
    return dict(STAFF.get(role, [])).get(uid, "Guest")


def hand_off(ret):
    """After an action on `ret`, show the "who's next" card on the next page."""
    session["handoff"] = ret.return_code


def guard(role):
    """Use as a blueprint before_request hook: only `role` may enter."""
    def check():
        if current_role() != role:
            abort(403, description=role)
        if role == "customer" and current_customer() is None:
            abort(403, description=role)
    return check
