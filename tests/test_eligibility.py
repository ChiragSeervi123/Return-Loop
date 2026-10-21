from services.eligibility import check_eligibility


def test_inside_window(app, make):
    item = make.item(make.customer(), days_ago=3)
    assert check_eligibility(item) == (True, "")


def test_last_day_of_window_is_allowed(app, make):
    item = make.item(make.customer(), days_ago=7)
    assert check_eligibility(item)[0] is True


def test_outside_window(app, make):
    item = make.item(make.customer(), days_ago=8)
    assert check_eligibility(item) == (False, "Window closed")


def test_not_returnable(app, make):
    item = make.item(make.customer(), returnable=False)
    assert check_eligibility(item) == (False, "Not returnable")


def test_duplicate_request(app, make):
    customer = make.customer()
    item = make.item(customer)
    make.ret(customer, item=item, status="Pickup Scheduled")
    assert check_eligibility(item) == (False, "Return already open")


def test_finished_return_cannot_be_repeated(app, make):
    customer = make.customer()
    item = make.item(customer)
    make.ret(customer, item=item, status="Closed")
    assert check_eligibility(item) == (False, "Already returned")


def test_cancelled_return_allows_a_new_request(app, make):
    customer = make.customer()
    item = make.item(customer)
    make.ret(customer, item=item, status="Cancelled")
    assert check_eligibility(item)[0] is True
