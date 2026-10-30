"""Smoke tests: every page renders for its role, and the customer flow works over HTTP."""
import io
from datetime import datetime, timedelta

import pytest

import seed
from config import PUBLIC_URL
from conftest import login
from models import ReturnRequest
from services.returns import (create_return, mark_picked_up, mark_received,
                              mark_repaired, schedule_pickup, submit_inspection)

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


@pytest.fixture
def seeded(app):
    customers, items = seed.build_catalogue()
    seed.seed_returns(customers, items)
    return customers, items


TOMORROW = (datetime.now() + timedelta(days=1)).date()
GOOD = dict(packaging_intact=True, tags_attached=True, item_matches_order=True, visible_damage=False)


def kettle_return(seeded, until="schedule"):
    """The seed has no returns in progress, so tests start one (the kettle) and move it along."""
    customers, items = seeded
    asha, kettle = customers[0], items[4][0]
    ret = create_return(asha, kettle, "Damaged", "Lid hinge snapped.")
    steps = ["schedule", "pickup", "receive", "grade_b", "repair"]
    for step in steps[: steps.index(until) + 1]:
        if step == "schedule":
            schedule_pickup(ret, TOMORROW, "Morning", asha.name)
        elif step == "pickup":
            mark_picked_up(ret.current_pickup, "Ayush Dubey")
        elif step == "receive":
            mark_received(ret, "Ansuman Singh")
        elif step == "grade_b":
            submit_inspection(ret, 1, GOOD, "B")
        elif step == "repair":
            mark_repaired(ret.refurbish_jobs[0], "Anumeet")
    return ret


def test_seed_leaves_staff_queues_empty(seeded):
    assert {r.status for r in ReturnRequest.query} <= {"Closed", "Refunded"}


def test_landing_and_switch(client, seeded):
    assert client.get("/").status_code == 200
    assert client.get("/switch").status_code == 200
    res = client.post("/switch", data={"who": "qc:1"})
    assert res.status_code == 302 and res.location.endswith("/qc/queue")


def test_bad_switch_is_ignored(client, seeded):
    client.post("/switch", data={"who": "admin:99"})
    assert client.get("/admin/dashboard").status_code == 403


def test_wrong_role_gets_friendly_403(client, seeded):
    login(client, "customer", 1)
    res = client.get("/qc/queue")
    assert res.status_code == 403
    assert b"Staff only" in res.data


def test_customer_pages_render(client, seeded):
    login(client, "customer", 1)
    ret = kettle_return(seeded)
    for url in ["/customer/orders", "/customer/returns", "/customer/return/RL-2026-0001",
                f"/customer/return/{ret.return_code}", f"/customer/return/{ret.return_code}/schedule"]:
        assert client.get(url).status_code == 200, url


def test_other_customers_return_is_404(client, seeded, make):
    stranger = make.customer("Bilal")
    theirs = make.ret(stranger)
    login(client, "customer", 1)
    assert client.get(f"/customer/return/{theirs.return_code}").status_code == 404
    assert client.get("/customer/return/RL-9999-0001").status_code == 404


def test_customer_return_flow_over_http(client, seeded):
    customers, items = seeded
    login(client, "customer", customers[0].id)
    lamp = items[0][0]

    res = client.post(f"/customer/return/new?item={lamp.id}", data={
        "reason": "Damaged", "comment": "Shade dented.",
        "photo": (io.BytesIO(PNG), "dent.png"),
    }, content_type="multipart/form-data")
    assert res.status_code == 302
    ret = ReturnRequest.query.filter_by(order_item_id=lamp.id).one()
    assert ret.photo_path.startswith("uploads/")

    # a second attempt on the same item is refused
    res = client.post(f"/customer/return/new?item={lamp.id}", data={"reason": "Damaged"})
    assert res.status_code == 400

    tomorrow = (datetime.now() + timedelta(days=1)).date().isoformat()
    res = client.post(f"/customer/return/{ret.return_code}/schedule",
                      data={"slot_date": tomorrow, "slot_window": "Evening"})
    assert res.status_code == 302
    assert ret.status == "Pickup Scheduled"

    data = client.get(f"/api/return/{ret.return_code}/status").get_json()
    assert data["step"] == 1


def test_bad_upload_is_refused(client, seeded):
    customers, items = seeded
    login(client, "customer", customers[0].id)
    res = client.post(f"/customer/return/new?item={items[0][1].id}", data={
        "reason": "Damaged", "photo": (io.BytesIO(b"%PDF-1.4"), "doc.pdf"),
    }, content_type="multipart/form-data")
    assert res.status_code == 400
    assert b"PNG, JPG or WEBP" in res.data
    assert ReturnRequest.query.filter_by(order_item_id=items[0][1].id).count() == 0


def test_ineligible_item_has_no_return_button(client, seeded):
    customers, items = seeded
    login(client, "customer", customers[0].id)
    page = client.get("/customer/orders").data.decode()
    assert "Not returnable" in page      # earbuds
    res = client.post(f"/customer/return/new?item={items[3][0].id}", data={"reason": "Damaged"})
    assert res.status_code == 400


def test_staff_pages_render(client, seeded):
    pages = {
        "agent": ["/agent/pickups"],
        "qc": ["/qc/queue", "/qc/queue?q=0001"],
        "refurbisher": ["/refurb/jobs"],
        "warehouse": ["/warehouse/receive", "/warehouse/inventory", "/warehouse/inventory?action=Scrapped"],
        "admin": ["/admin/dashboard"],
    }
    for role, urls in pages.items():
        login(client, role, 1)
        for url in urls:
            assert client.get(url).status_code == 200, url
    ret = kettle_return(seeded, "receive")
    login(client, "qc", 1)
    assert client.get(f"/qc/inspect/{ret.return_code}").status_code == 200
    submit_inspection(ret, 1, GOOD, "B")
    mark_repaired(ret.refurbish_jobs[0], "Anumeet")
    assert client.get(f"/qc/inspect/{ret.return_code}").status_code == 200  # re-inspection view


def test_customer_return_shows_up_on_each_staff_screen(client, seeded):
    """A return made by the customer appears for each role exactly when it's their turn."""
    ret = kettle_return(seeded)
    code = ret.return_code

    def page(role, url):
        """The desk's work list only, not its "still moving" section below it."""
        login(client, role, 1)
        return client.get(url).data.decode().split('class="in-flight"')[0]

    assert code in page("agent", "/agent/pickups")
    assert code not in page("warehouse", "/warehouse/receive")
    mark_picked_up(ret.current_pickup, "Ayush Dubey")
    assert code in page("warehouse", "/warehouse/receive")
    assert code not in page("qc", "/qc/queue")
    mark_received(ret, "Ansuman Singh")
    assert code in page("qc", "/qc/queue")
    submit_inspection(ret, 1, GOOD, "B")
    assert code in page("refurbisher", "/refurb/jobs")
    assert code not in page("qc", "/qc/queue")
    mark_repaired(ret.refurbish_jobs[0], "Anumeet")
    assert code in page("qc", "/qc/queue")


def test_staff_flow_over_http(client, seeded):
    """Agent -> warehouse -> QC grade B -> refurbisher -> QC recheck -> refund."""
    ret = kettle_return(seeded)
    pickup = ret.current_pickup

    login(client, "agent", pickup.agent_id)
    assert client.get(f"/agent/pickup/{pickup.id}").status_code == 200
    client.post(f"/agent/pickup/{pickup.id}", data={"action": "picked"})
    assert ret.status == "Picked Up"

    login(client, "warehouse", 1)
    client.post(f"/warehouse/receive/{ret.return_code}")
    assert ret.status == "Received"
    # double click: second post is refused, status unchanged
    client.post(f"/warehouse/receive/{ret.return_code}")
    assert ret.status == "Received"

    login(client, "qc", 1)
    client.post(f"/qc/inspect/{ret.return_code}", data={
        "packaging_intact": "on", "tags_attached": "on", "item_matches_order": "on", "grade": "B"})
    assert ret.status == "Refurbishing"

    login(client, "refurbisher", 1)
    job = ret.refurbish_jobs[0]
    client.post(f"/refurb/jobs/{job.id}/repaired", data={"notes": "New hinge"})
    assert ret.status == "Re-inspection"

    login(client, "qc", 1)
    client.post(f"/qc/inspect/{ret.return_code}", data={
        "packaging_intact": "on", "tags_attached": "on", "item_matches_order": "on", "grade": "B"})
    assert ret.status == "Refunded"
    assert ret.refund.grade_percent == 70
    # double submit does not create a second refund
    client.post(f"/qc/inspect/{ret.return_code}", data={"item_matches_order": "on", "grade": "B"})
    assert len(ret.history) == 9


def test_qc_fraud_rejection_over_http(client, seeded):
    ret = kettle_return(seeded, "receive")
    login(client, "qc", 1)
    client.post(f"/qc/inspect/{ret.return_code}", data={"packaging_intact": "on", "grade": "A"})
    assert ret.status == "Rejected" and ret.flagged_fraud


def test_agent_absent_twice_over_http(client, seeded):
    ret = kettle_return(seeded)
    login(client, "agent", ret.current_pickup.agent_id)
    client.post(f"/agent/pickup/{ret.current_pickup.id}", data={"action": "absent"})
    assert ret.status == "Pickup Scheduled"
    client.post(f"/agent/pickup/{ret.current_pickup.id}", data={"action": "absent"})
    assert ret.status == "Cancelled"


def test_agent_cannot_open_pickup_assigned_elsewhere(client, seeded):
    ret = kettle_return(seeded)
    login(client, "agent", ret.current_pickup.agent_id + 1)
    assert client.get(f"/agent/pickup/{ret.current_pickup.id}").status_code == 404


def test_admin_dashboard_shows_flagged_customer(client, seeded):
    # 3 seeded returns don't flag; the customer's 4th return does
    login(client, "admin", 1)
    assert "Nobody flagged" in client.get("/admin/dashboard").data.decode()
    kettle_return(seeded)
    page = client.get("/admin/dashboard").data.decode()
    assert "Chirag" in page and "Nobody flagged" not in page


def test_team_page_lists_every_member(client, seeded):
    page = client.get("/team").data.decode()
    for name in ("Chirag", "Seervi", "Anshuman", "Aryan", "Aadi", "Srivastava"):
        assert name in page
    assert '["CHIRAG", "ANSHUMAN", "ARYAN", "AADI"]' in page  # words the particles spell
    assert "Four people." in page and "Packed by four." in page and "04 / 04" in page


def test_presentation_credits_the_whole_team(client, seeded):
    page = client.get("/ppt").data.decode()
    assert "Aadi Srivastava" in page and "<span>PRESENTED BY</span><span>04</span>" in page


def test_presentation_has_every_section(client, seeded):
    page = client.get("/ppt").data.decode()
    for section in ("PLANNING &amp; MANAGEMENT", "Functional requirements", "Non-functional requirements",
                    "USE CASE DIAGRAM", "CLASS DIAGRAM", "LEVEL 0", "LEVEL 1", "ACTIVITY DIAGRAM",
                    "SEQUENCE DIAGRAM", "STATE DIAGRAM", "Handing a return to the next desk",
                    "Layered architecture", "FROM UI TO DATA"):
        assert section in page, section
    assert page.count("data-slide ") + page.count("data-slide>") >= 18


def test_presentation_agenda_points_at_the_right_slides(client, seeded):
    import re
    page = client.get("/ppt").data.decode()
    slides = re.findall(r'<section class="slide[^"]*" data-slide aria-label="([^"]+)"', page)
    for no, topic in re.findall(r'data-goto="(\d+)"><b>\d+</b> ([^<]+)<small', page):
        first_word = topic.split()[0].strip(":,").lower()
        assert first_word in slides[int(no) - 1].lower(), (no, topic, slides[int(no) - 1])


def test_polish_labels_money_and_agent_header(client, seeded):
    """Role labels instead of role keys, Indian money format in notes, and a useful agent header."""
    ret = kettle_return(seeded, "receive")
    submit_inspection(ret, 1, GOOD, "A")
    assert ret.history[-1].note.startswith("Refund of ₹") and ".00" not in ret.history[-1].note

    login(client, "customer", ret.customer_id)
    page = client.get(f"/customer/return/{ret.return_code}").data.decode()
    assert "· QC inspector" in page and "· qc<" not in page


def test_agent_header_points_at_upcoming_pickups(client, seeded):
    ret = kettle_return(seeded)                   # booked for tomorrow
    login(client, "agent", ret.current_pickup.agent_id)
    page = client.get("/agent/pickups").data.decode()
    assert "Nothing today. 1 coming up" in page
    assert "Kettle on" not in page                # no big empty box above real work
    assert "· Pickup agent" in page               # footer uses the role label


def test_static_files_can_be_cached_at_the_edge(client, seeded):
    res = client.get("/static/css/main.css")
    assert res.status_code == 200 and "s-maxage=31536000" in res.headers["Cache-Control"]
    assert "s-maxage" not in client.get("/").headers.get("Cache-Control", "")   # pages stay live


def test_landing_carries_the_makers_mark(client, seeded):
    page = client.get("/").data.decode()
    assert 'href="/maker" aria-label="Designed and built by Chirag Seervi' in page
    assert "MADE BY CHIRAG SEERVI" in page


def test_maker_page_shows_the_id_card(client, seeded):
    page = client.get("/maker").data.decode()
    for text in ("Chirag", "Seervi", "SVKM&#39;s NMIMS, Hyderabad", "B.Tech", "Computer Science and Engineering (Data Science)",
                 "Division A · 2025 – 2029", "70572500055", "A055"):
        assert text in page, text


def test_docs_page_has_every_required_part(client, seeded):
    """The faculty's list: FR, NFR, use case, activity, swimlane, class, CRC, DFD, state,
    sequence diagrams, wireframes and prototypes, plus a PDF to download."""
    page = client.get("/docs").data.decode()
    for part in ("Functional requirements", "Non-functional requirements", "Use case diagram",
                 "Activity diagram", "Swimlane diagram", "Class diagram", "CRC cards",
                 "DFD level 0", "DFD level 1", "State diagram", "Sequence: QC grades",
                 "Sequence: handing a return", "Wireframes", "Prototypes", "FR13", "NFR08"):
        assert part in page, part
    assert "mermaid.esm" not in page and "three.module" not in page.split("</head>")[1]  # no heavy libraries
    assert client.get("/static/docs/ReturnLoop-Documentation.pdf").status_code == 200


def test_docs_cover_has_a_qr_to_the_live_app(client, seeded):
    cover = client.get("/docs").data.decode().split('class="doc-cover"')[1].split("</section>")[0]
    assert f"<title>QR code: {PUBLIC_URL}</title>" in cover and f'href="{PUBLIC_URL}"' in cover
    assert 'class="barcode' not in cover


def test_docs_link_sits_between_ppt_and_team(client, seeded):
    page = client.get("/").data.decode()
    nav = page.split('aria-label="Main"')[1].split("</nav>")[0]
    assert nav.index(">PPT<") < nav.index(">Docs<") < nav.index(">Team<")


def test_each_desk_has_its_own_workplace(client, seeded):
    """Agent works in a phone, warehouse sees labelled parcels, QC has the inspection
    table, admin has the control room with a live feed."""
    ret = kettle_return(seeded, "pickup")            # collected, waiting at the dock
    login(client, "agent", 1)
    page = client.get("/agent/pickups").data.decode()
    assert 'class="phone"' in page and "data-touch" in page and "route-map" in page

    login(client, "warehouse", 1)
    page = client.get("/warehouse/receive").data.decode()
    sticker = page.split(f'id="{ret.return_code}"')[1].split("</article>")[0]
    assert ret.product.name in sticker and ret.customer.name in sticker and ret.reason in sticker
    assert "Mark received at centre" in sticker

    client.post(f"/warehouse/receive/{ret.return_code}")
    login(client, "qc", 1)
    page = client.get(f"/qc/inspect/{ret.return_code}").data.decode()
    assert "data-qc-bench" in page and page.count("data-qc-turn=") == 6
    assert f'data-code="{ret.return_code}"' in page

    login(client, "admin", 1)
    page = client.get("/admin/dashboard").data.decode()
    assert "control-page" in page and "Live feed" in page and ret.return_code in page.split("Live feed")[1]
