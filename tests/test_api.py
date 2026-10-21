from conftest import login


def test_status_endpoint_returns_correct_data(app, client, make):
    customer = make.customer()
    ret = make.ret(customer, status="Picked Up")
    login(client, "customer", customer.id)

    res = client.get(f"/api/return/{ret.return_code}/status")

    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "Picked Up"
    assert data["step"] == 2
    assert data["terminal"] is False
    assert data["updated_at"]


def test_status_endpoint_refuses_other_customers(app, client, make):
    owner, other = make.customer("Asha"), make.customer("Bilal")
    ret = make.ret(owner)
    login(client, "customer", other.id)
    assert client.get(f"/api/return/{ret.return_code}/status").status_code == 404


def test_status_endpoint_unknown_code(app, client, make):
    customer = make.customer()
    login(client, "customer", customer.id)
    assert client.get("/api/return/RL-0000-9999/status").status_code == 404


def test_status_endpoint_needs_a_customer(app, client, make):
    ret = make.ret(make.customer())
    login(client, "qc", 1)
    assert client.get(f"/api/return/{ret.return_code}/status").status_code == 403
