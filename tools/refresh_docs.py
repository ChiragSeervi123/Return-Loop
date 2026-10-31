"""Refresh everything the documentation shows from the app itself: the diagrams it
borrows from the presentation, the prototype screenshots, and both PDFs.

    pip install playwright        # once; add `playwright install chromium` if there's no Edge or Chrome
    python tools/refresh_docs.py

It starts its own copy of the app on a spare port with a fresh, throwaway database
(your returnloop.db is never touched), moves a few returns to every desk, and then:
  1. saves the presentation's Mermaid diagrams as static SVG (templates/diagrams/*.svg),
  2. screenshots each prototype screen at 1440 x 900 in the light theme (static/docs/proto/*.jpg),
  3. rebuilds the two PDFs (see make_pdfs.py).
"""
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_pdfs import ROOT, build, launch  # noqa: E402

DIAGRAMS = ["class", "dfd0", "dfd1", "seq_refund", "seq_handoff"]   # in the order the deck draws them
PROTO = ROOT / "static" / "docs" / "proto"


def start_app(tmp):
    """Seed a throwaway database and serve the app on a free port. Returns (process, base URL)."""
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{(tmp / 'docs.db').as_posix()}"}
    env.pop("VERCEL", None)
    subprocess.run([sys.executable, "seed.py"], cwd=ROOT, env=env, check=True, stdout=subprocess.DEVNULL)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    # auto_reload: the diagrams saved in step 1 must show up in the PDFs of step 3
    code = f"from app import create_app; a = create_app(); a.jinja_env.auto_reload = True; a.run(port={port})"
    server = subprocess.Popen([sys.executable, "-c", code], cwd=ROOT, env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    for _ in range(60):
        try:
            urllib.request.urlopen(base + "/", timeout=2)
            return server, base
        except OSError:
            if server.poll() is not None:
                break
            time.sleep(0.5)
    server.terminate()
    raise SystemExit("The app did not start.")


def export_diagrams(page, base):
    """Save the deck's rendered Mermaid diagrams as SVG, with stable ids (no churn when unchanged)."""
    page.goto(f"{base}/ppt")
    # the deck renames each diagram's markers after drawing (…-d0 to …-d4); wait for the last one
    page.wait_for_function("!!document.querySelector('.deck pre.mermaid svg marker[id$=\"-d4\"]')", timeout=120000)
    svgs = page.evaluate("() => [...document.querySelectorAll('.deck pre.mermaid svg')].map((s) => s.outerHTML)")
    if len(svgs) != len(DIAGRAMS):
        raise SystemExit(f"Expected {len(DIAGRAMS)} diagrams in the deck, found {len(svgs)}.")
    for name, svg in zip(DIAGRAMS, svgs):
        root = re.search(r'id="(mermaid-\d+)"', svg)
        if root:
            svg = svg.replace(root.group(1), f"rl-{name}")
        (ROOT / "templates" / "diagrams" / f"{name}.svg").write_text(svg, encoding="utf-8")
        print("saved diagram", name)


def shoot_prototypes(page, base):
    """Move returns to every desk, then screenshot each screen the documentation shows."""
    tomorrow = (date.today() + timedelta(days=1)).isoformat()

    def post(path, **kw):
        return page.request.post(base + path, max_redirects=0, **kw)

    def who(role):
        post("/switch", form={"who": role})

    def new_return(item, reason, comment=""):
        res = post(f"/customer/return/new?item={item}", multipart={"reason": reason, "comment": comment})
        return re.search(r"(RL-[\d-]+)/schedule", res.headers["location"]).group(1)

    def book(code, window):
        post(f"/customer/return/{code}/schedule", form={"slot_date": tomorrow, "slot_window": window})

    def pickup_id(code):
        html = page.request.get(base + "/agent/pickups").text()
        return re.search(r'/agent/pickup/(\d+)"(?:(?!</a>).)*' + code, html, re.S).group(1)

    def shoot(name, path, wait=1800, scroll_to=None, fresh=True):
        if fresh:   # a plain page view uses up any pending toasts and handoff card
            page.request.get(base + "/team")
        page.goto(base + path)
        page.wait_for_timeout(wait)
        if scroll_to:   # bring this element to just under the top bar
            page.evaluate("(sel) => window.scrollTo(0, document.querySelector(sel).getBoundingClientRect().top + scrollY - 70)", scroll_to)
            page.wait_for_timeout(900)
        page.screenshot(path=str(PROTO / f"{name}.jpg"), type="jpeg", quality=72)
        print("saved prototype", name)

    shoot("landing", "/", wait=4500, fresh=False)   # as a first-time visitor

    who("customer:1")
    shoot("orders", "/customer/orders")
    free = re.findall(r"return/new\?item=(\d+)", page.request.get(base + "/customer/orders").text())
    if len(free) < 7:
        raise SystemExit(f"The seed needs 7 returnable items, found {len(free)}.")
    shoot("new-return", f"/customer/return/new?item={free[0]}")
    codes = {
        "track": new_return(free[0], "Damaged", "Lid hinge snapped on arrival."),
        "schedule": new_return(free[1], "Changed my mind"),
        "stop": new_return(free[2], "Not as described", "Colour is darker than the photos."),
        "dock1": new_return(free[3], "Wrong item"),
        "dock2": new_return(free[4], "Damaged"),
        "qc": new_return(free[5], "Not as described", "Zip pull is a different colour."),
        "bench": new_return(free[6], "Damaged", "Box crushed, tags torn off."),
    }
    for key, window in [("stop", "Afternoon"), ("dock1", "Morning"), ("dock2", "Evening"), ("qc", "Morning"), ("bench", "Afternoon")]:
        book(codes[key], window)
    shoot("schedule", f"/customer/return/{codes['schedule']}/schedule")
    book(codes["track"], "Evening")
    shoot("track", f"/customer/return/{codes['track']}", wait=3500, fresh=False)   # keeps the handoff card

    who("agent:1")
    for key in ("dock1", "dock2", "qc", "bench"):
        post(f"/agent/pickup/{pickup_id(codes[key])}", form={"action": "picked"})
    shoot("agent", "/agent/pickups")

    who("warehouse:1")
    for key in ("qc", "bench"):
        post(f"/warehouse/receive/{codes[key]}")
    shoot("warehouse", "/warehouse/receive")

    who("qc:1")   # grade one B with everything QC can find wrong, so the workshop has work
    post(f"/qc/inspect/{codes['bench']}", form={"item_matches_order": "on", "visible_damage": "on", "grade": "B",
                                                "remarks": "Corner crushed, tags missing, tape split."})
    shoot("inspect", f"/qc/inspect/{codes['qc']}", wait=3500, scroll_to="[data-qc-bench]")

    who("refurbisher:1")
    shoot("workshop", "/refurb/jobs", wait=3500, scroll_to="[data-workbench]")

    who("admin:1")
    shoot("dashboard", "/admin/dashboard", wait=2500)


def main():
    tmp = Path(tempfile.mkdtemp(prefix="returnloop-docs-"))
    server, base = start_app(tmp)
    try:
        with sync_playwright() as p:
            browser = launch(p)
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            context.add_init_script("try { localStorage.setItem('rl-theme', 'light'); } catch (e) {}")
            page = context.new_page()
            export_diagrams(page, base)
            shoot_prototypes(page, base)
            context.close()
            build(base, browser)
            browser.close()
    finally:
        server.terminate()
        server.wait()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
