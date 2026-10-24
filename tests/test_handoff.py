"""The handoff relay: after each desk acts, a card offers to continue as the next desk."""
import re

from test_pages import GOOD, TOMORROW, kettle_return, seeded  # noqa: F401  (fixture)
from conftest import login
from models import ReturnRequest, db
from services.handoff import handoff_for, in_flight, next_desk, relay
from services.returns import create_return, submit_inspection


def continue_form(html):
    """The hidden fields of the handoff card's "Continue as" button, or None if there is no card."""
    card = re.search(r'<aside class="handoff.*?</aside>', html, re.S)
    if not card:
        return None
    form = re.search(r'<form class="handoff-go".*?</form>', card.group(0), re.S).group(0)
    return dict(re.findall(r'name="(who|next|code)" value="([^"]*)"', form))


def follow(client, html):
    """Press "Continue as ..." and return the page we land on."""
    fields = continue_form(html)
    assert fields, "expected a handoff card"
    res = client.post("/switch", data=fields)
    assert res.status_code == 302 and res.location == fields["next"]
    return client.get(fields["next"]).data.decode()


def test_next_desk_follows_the_return(seeded):
    ret = kettle_return(seeded, "schedule")
    assert next_desk(ret)["role"] == "agent"
    assert next_desk(ret)["args"] == {"pickup_id": ret.current_pickup.id}


def test_relay_from_customer_to_admin_using_only_the_card(client, seeded):
    """Book -> agent -> warehouse -> QC (B) -> refurbisher -> QC -> customer -> admin."""
    customers, _ = seeded
    asha = customers[0]
    login(client, "customer", asha.id)

    # The customer books a pickup and gets the card pointing at the pickup agent.
    item = seeded[1][4][0]
    ret = create_return(asha, item, "Damaged", "Lid hinge snapped.")
    client.post(f"/customer/return/{ret.return_code}/schedule",
                data={"slot_date": TOMORROW.isoformat(), "slot_window": "Morning"})
    html = client.get(f"/customer/return/{ret.return_code}").data.decode()
    assert "Your part is done." in html and "Continue as pickup agent" in html

    html = follow(client, html)                      # now the agent, on this exact pickup
    assert "Mark picked up" in html and ret.return_code in html
    client.post(f"/agent/pickup/{ret.current_pickup.id}", data={"action": "picked"})
    html = client.get("/agent/pickups").data.decode()
    assert "Continue as warehouse" in html

    html = follow(client, html)                      # warehouse, row highlighted
    assert "job--focus" in html
    client.post(f"/warehouse/receive/{ret.return_code}")
    html = client.get("/warehouse/receive").data.decode()
    assert "Continue as QC inspector" in html

    html = follow(client, html)                      # QC, straight onto the inspect form
    client.post(f"/qc/inspect/{ret.return_code}", data={
        "packaging_intact": "on", "tags_attached": "on", "item_matches_order": "on", "grade": "B"})
    html = client.get("/qc/queue").data.decode()
    assert "Continue as refurbisher" in html

    html = follow(client, html)                      # refurbisher
    assert "job--focus" in html
    client.post(f"/refurb/jobs/{ret.refurbish_jobs[0].id}/repaired", data={"notes": "New hinge"})
    html = client.get("/refurb/jobs").data.decode()

    html = follow(client, html)                      # QC again, for the re-inspection
    client.post(f"/qc/inspect/{ret.return_code}", data={
        "packaging_intact": "on", "tags_attached": "on", "item_matches_order": "on", "grade": "B"})
    assert ret.status == "Refunded"
    html = client.get("/qc/queue").data.decode()
    assert "Continue as customer" in html

    html = follow(client, html)                      # back to the customer, who closes it
    client.post(f"/customer/return/{ret.return_code}/close")
    html = client.get(f"/customer/return/{ret.return_code}").data.decode()
    assert "Continue as admin" in html

    html = follow(client, html)                      # the admin sees the loop complete
    assert "The loop is complete." in html and "Start another return" in html
    assert db.session.get(ReturnRequest, ret.id).status == "Closed"


def test_card_shows_once(client, seeded):
    ret = kettle_return(seeded, "pickup")
    login(client, "warehouse", 1)
    client.post(f"/warehouse/receive/{ret.return_code}")
    assert continue_form(client.get("/warehouse/receive").data.decode())
    assert continue_form(client.get("/warehouse/receive").data.decode()) is None


def test_no_card_when_the_same_person_acts_next(client, seeded):
    """First missed pickup: the same agent tries again tomorrow, so nothing to hand over."""
    ret = kettle_return(seeded)
    login(client, "agent", ret.current_pickup.agent_id)
    client.post(f"/agent/pickup/{ret.current_pickup.id}", data={"action": "absent"})
    assert continue_form(client.get("/agent/pickups").data.decode()) is None


def test_relay_marks_skipped_refurbisher_for_grade_a(seeded):
    ret = kettle_return(seeded, "receive")
    submit_inspection(ret, 1, GOOD, "A")
    states = {s["role"]: s["state"] for s in relay(ret, next_desk(ret)["role"])}
    assert states == {"customer": "next", "agent": "done", "warehouse": "done", "qc": "done",
                      "refurbisher": "skipped", "admin": "ahead"}


def test_rejected_return_ends_with_the_customer(seeded):
    ret = kettle_return(seeded, "receive")
    submit_inspection(ret, 1, dict(GOOD, item_matches_order=False), "A")
    assert ret.status == "Rejected"
    assert handoff_for(ret, "qc", 1)["desk"]["role"] == "customer"
    assert handoff_for(ret, "customer", ret.customer_id)["kind"] == "end"


def test_switch_never_redirects_off_site(client, seeded):
    for bad in ("https://evil.example", "//evil.example", "/\\evil.example"):
        res = client.post("/switch", data={"who": "qc:1", "next": bad})
        assert res.location == "/qc/queue"


def test_switching_by_hand_drops_a_pending_card(client, seeded):
    ret = kettle_return(seeded, "pickup")
    login(client, "warehouse", 1)
    client.post(f"/warehouse/receive/{ret.return_code}")       # card pending for the warehouse
    client.post("/switch", data={"who": "customer:1"})         # but someone else takes over
    assert continue_form(client.get(f"/customer/return/{ret.return_code}").data.decode()) is None


def test_each_desk_lists_what_it_handed_on(client, seeded):
    """After the warehouse checks a parcel in, the agent and warehouse both see where it went."""
    ret = kettle_return(seeded, "receive")
    for role, url in (("agent", "/agent/pickups"), ("warehouse", "/warehouse/receive"),
                      ("admin", "/admin/dashboard")):
        login(client, role, ret.current_pickup.agent_id if role == "agent" else 1)
        moving = client.get(url).data.decode().split('class="in-flight"')[1]
        assert ret.return_code in moving and "WITH AADI SRIVASTAVA" in moving
    login(client, "customer", ret.customer_id)
    assert "Continue as QC inspector" in client.get("/customer/returns").data.decode()


def test_finished_returns_leave_the_lists(seeded):
    ret = kettle_return(seeded, "receive")
    submit_inspection(ret, 1, dict(GOOD, item_matches_order=False), "A")   # rejected
    assert all(row["ret"].id != ret.id for row in in_flight("admin", 1))
    assert all(row["ret"].id != ret.id for row in in_flight("warehouse", 1))
