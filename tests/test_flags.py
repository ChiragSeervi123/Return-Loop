from datetime import datetime, timedelta

from services.flags import flagged_customers, is_frequent_returner


def test_three_returns_does_not_flag(app, make):
    customer = make.customer()
    for _ in range(3):
        make.ret(customer)
    assert not is_frequent_returner(customer.id)
    assert flagged_customers() == []


def test_four_returns_flags(app, make):
    customer = make.customer()
    for _ in range(4):
        make.ret(customer)
    assert is_frequent_returner(customer.id)
    assert flagged_customers() == [(customer, 4)]


def test_old_returns_do_not_count(app, make):
    customer = make.customer()
    for _ in range(2):
        make.ret(customer)
    for _ in range(2):
        make.ret(customer, created_at=datetime.now() - timedelta(days=40))
    assert not is_frequent_returner(customer.id)
