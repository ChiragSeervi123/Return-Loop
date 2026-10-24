# ReturnLoop

A returns and reverse-logistics centre for an e-commerce business. A customer asks to return an item, an agent picks it up, the warehouse checks it in, QC grades it A/B/C, and the item is restocked, refurbished or scrapped. Then the refund is worked out to the rupee.

Built with Flask (Blueprints), Jinja2, SQLite through Flask-SQLAlchemy, and pytest. The frontend is plain CSS and vanilla ES modules: Three.js r160 for the 3D scenes, GSAP 3.12 with ScrollTrigger on the landing page, and Chart.js on the admin dashboard. All of them load from CDNs. There is no npm and no build step.

## Setup

```bash
pip install -r requirements.txt && python seed.py && python app.py
```

Then open <http://127.0.0.1:5000>. Python 3.10 or newer is required.

- `python seed.py` deletes the database and rebuilds it with demo data. Run it again any time you want a clean demo.
- Run the tests with `python -m pytest`.
- An internet connection is needed for fonts, Three.js, GSAP and Chart.js. Without one, every page still works: the 3D sections fall back to static CSS or SVG versions, and the charts become plain lists.

## Logging in (there is none)

The "Switch role" menu in the top bar stores a role and a user id in the session. The same choice is on the `/switch` page, which the landing page's "Staff entry" button opens. "Start a return" signs you in as the first customer. If you open a page that belongs to another role, you get a friendly 403 page with a one-click switch. You rarely need the menu, though: after each step the app hands the return to the next desk for you (see below).

| Role | Seeded people | Pages |
|---|---|---|
| Customer | Chirag | `/customer/orders`, `/customer/return/new?item=ID`, `/customer/return/<code>/schedule`, `/customer/returns`, `/customer/return/<code>` (tracking) |
| Pickup agent | Ayush Dubey | `/agent/pickups`, `/agent/pickup/<id>` |
| Warehouse manager | Ansuman Singh | `/warehouse/receive`, `/warehouse/inventory` |
| QC inspector | Ayusman | `/qc/queue`, `/qc/inspect/<code>` |
| Refurbisher | Anumeet | `/refurb/jobs` |
| Admin | Aryan Singh | `/admin/dashboard` |
| Anyone | | `/` (landing page), `/switch`, `/ppt` (presentation), `/team` (the crew) |
| API (customer only) | | `/api/return/<code>/status` |

## Following a return from desk to desk

After anyone finishes their part of a return, a **handoff card** slides up: *Your part is done*, what just happened, who is next and what they'll do, and a strip of all six desks (done, next, skipped). **Continue as …** switches to that person and opens the exact item waiting for them: the agent's pickup slip, the QC inspection form, or the highlighted row on the warehouse dock or repair bench. The relay runs Customer → Pickup agent → Warehouse → QC → (Refurbisher → QC again, grade B only) → Customer, who confirms the refund and closes the return → Admin, where a **Loop complete** card offers *Start another return*.

If the card is closed, the same **Continue as …** button is still around:

- the customer's tracking page shows who holds the return now ("With Ayush Dubey · Pickup agent");
- each staff page ends with a **still moving** section: the unfinished returns that desk handed on, and where each one is now;
- the admin dashboard has **Where every return is right now**, covering every unfinished return.

The rules for who is next live in `next_desk()` in [services/handoff.py](services/handoff.py). The card shows once, right after the action; switching by hand through the menu drops it.

## Business rules

All the numbers live in [config.py](config.py), each with a comment. All the logic lives in [services/](services/).

| Rule | Value | Where |
|---|---|---|
| Return window | 7 days from `delivered_at`, counted in whole days (delivered on the 1st, returnable until the end of the 8th) | `RETURN_WINDOW_DAYS`, `services/eligibility.py` |
| Not eligible when | outside the window, the product is not returnable, or the item already has a return that isn't cancelled | `services/eligibility.py` |
| Grade A | 100% refund, item restocked | `GRADE_REFUND_PERCENT`, `GRADE_ROUTE` |
| Grade B | sent to refurbishing. If the repair passes re-inspection, the item is restocked and the refund is 70%. If it fails, the item becomes grade C | `services/returns.py` |
| Grade C | 0% refund, item scrapped | |
| Damaged / wrong-item exception | 100% refund whatever the grade, if QC confirms the claim (visible damage for "Damaged", item doesn't match the order for "Wrong item"). The item is still routed by its grade | `FULL_REFUND_REASONS`, `services/refund.py` |
| Pickup fee | ₹50, deducted only for "Changed my mind" | `PICKUP_FEE` |
| Refund formula | `final = max(0, base × grade% − pickup fee)`, with every part stored | `services/refund.py` |
| Pickup attempts | 2. The first "customer absent" rebooks the pickup for the next day in the same slot; the second cancels the return and records why | `MAX_PICKUP_ATTEMPTS` |
| Frequent returner | more than 3 return requests in 30 days. Shown to the admin; the customer is never blocked | `FREQUENT_RETURN_LIMIT`, `services/flags.py` |
| Suspected fraud | QC unticks "item matches order" on a return whose reason isn't "Wrong item": the return is rejected and `flagged_fraud` is set | `services/returns.py` |
| Refund atomicity | the refund row, the inventory_log row and the move to "Refunded" are committed in one transaction. `refunds.return_id` is unique, so a second refund is impossible | `services/refund.py` |
| Status changes | only through `change_status()` in `services/state_machine.py`, which checks the move against the transition table, writes `status_history` and updates `updated_at` | |

## Demo script

Run `python seed.py` (or `reset.bat`) first so the codes below match.

**What the seed contains.** One customer, Chirag, with 12 delivered orders. 7 items are returnable; the others show *Window closed* or *Not returnable*, which is handy for explaining the rules. Chirag also has 3 finished returns (RL-2026-0001 to 0003, closed or refunded) in *My returns*, so the admin charts and the warehouse inventory aren't empty. **The Agent, Warehouse, QC and Refurbisher queues start empty**: everything that appears there comes from returns you make as the customer, and each return shows up on a screen only when it is that role's turn.

1. **Landing.** Open `/`. Scroll through the 3D loop, the five-step "How a return flows" section, the three stamps and the numbers.
2. **Customer returns an item.** Click **Start a return** (you become Chirag). On the *Brass Desk Lamp* slip, click **Return item**. Pick **Damaged**, write a comment, and drag a PNG or JPG photo onto the drop zone. Click **Request return**. The return gets code **RL-2026-0004**.
3. **Book the pickup.** Pick any day and the **Evening** slot, tick the address box, and click **Book pickup**. The tracking page shows the parcel at "Scheduled", and the handoff card slides up: *Your part is done. Next up: Ayush Dubey, pickup agent, collects the parcel…* To watch the tracking page update live later, open it in a second tab now.
4. **Agent picks it up.** Click **Continue as pickup agent** on the card. You are now Ayush Dubey, on the RL-2026-0004 pickup slip. Click **Mark picked up** and confirm in the modal. Within 5 seconds the customer's tracking tab moves the parcel to "Picked up".
5. **Warehouse receives it.** The card now points at Ansuman Singh. Click **Continue as warehouse**: RL-2026-0004 is highlighted on the inbound dock. Click **Mark received at centre**.
6. **QC grades it B.** Click **Continue as QC inspector**, which opens RL-2026-0004's inspection form. Leave the checklist ticked, choose the **B** stamp, and click **Stamp it**. You get the full-screen stamp moment: the stamp slams down, the screen shakes, and ink sparks fly. The return moves to *Refurbishing*.
7. **Refurbisher repairs it.** Click **Continue as refurbisher**: the job is highlighted on the bench. Add a note and click **Mark repaired**. The return goes to *Re-inspection*.
8. **QC rechecks.** Click **Continue as QC inspector** again. The form opens marked *Re-inspection*. Keep **B (repair passed)** and click **Stamp it**.
9. **Refund appears.** Click **Continue as customer**. Chirag's tracking page shows RL-2026-0004 at "Refunded", and the breakdown counts up: ₹2,499 × 70% − ₹0 = ₹1,749.30. Damage wasn't confirmed by QC, so the grade decides the refund. Click **Got it, close this return**.
10. **Loop complete.** Click **Continue as admin**. Aryan Singh's dashboard opens with the **Loop complete** card and every desk ticked. "Returns logged" is now 4, the refunded total has grown, and the reasons bar chart and the grades doughnut include the new return. This was Chirag's 4th return in 30 days, so they now appear under **Frequent returners** (3 doesn't flag; 4 does). **Start another return** on the card goes back to Chirag's orders.

The top-bar menu still switches to anyone at any time, if you'd rather jump around.

Other things to try:

- Return another item as Chirag and book a pickup. As Ayush Dubey, click **Customer absent** twice. The first miss rebooks it for the same agent, so no card appears; the second cancels it, and the card hands it back to Chirag, whose tracking page says why.
- Take a return to the QC queue (book it, pick it up, receive it). Untick **Item matches order** and submit. After the confirmation modal, it is rejected as suspected fraud.
- Take a return through grade B and the repair, then recheck it with **C**: the failed repair scraps the item, and Chirag's tracking page shows it scrapped.
- Try returning the *Canvas Backpack* or the *In-ear Earbuds*: the button is replaced by *Window closed* / *Not returnable*.
- Open `/customer/return/RL-2026-9999`. That code doesn't exist, so you get the 404 page. (Another customer's return gives the same 404; the tests check this.)

## Assumptions

Decisions I made where the spec was open:

- **Project layout.** The spec's `returnloop/` folder is the repository root itself.
- **Staff accounts.** The schema has no staff table, so staff are defined in `config.STAFF`. `pickups.agent_id`, `qc_reports.inspector_id` and `refurbish_jobs.technician_id` hold those ids.
- **One person per role.** The spec asks for three seeded customers; on request this was cut to one customer (Chirag) and one pickup agent (Ayush Dubey), so a whole return can be followed without hunting for the right person. All 12 orders belong to Chirag. Adding people back only needs `CUSTOMERS` in `seed.py` and `STAFF` in `config.py`.
- **Seed has no returns in progress.** On request, the seed only contains finished returns (in the customer's history), so every item in the staff queues comes from the customer during the demo. The spec asked for about 8 returns in varied states; this replaces that.
- **Frequent-returner seed.** The spec's rule is "more than 3 returns in 30 days", and its tests say 3 does not flag and 4 does. Chirag starts with 3 returns, so their first return in the demo gets them flagged on the admin dashboard.
- **Requested → Rejected.** Ineligible items are stopped before a return is created: the button is disabled, and the server refuses the request if someone posts it anyway. So this transition exists in the state machine and is tested, but no screen uses it.
- **When is a return "open".** An item can't be returned again while it has any return that isn't *Cancelled*. A finished return shows "Already returned"; a cancelled one (customer absent twice) can be requested again while the window is still open.
- **First absent attempt.** The agent's "Customer absent" rebooks automatically for the next day, same slot, same agent, and records it as Pickup Scheduled → Pickup Scheduled. The customer can still reschedule.
- **Agent list.** "Today's pickups" lists today's (and overdue) stops first. Upcoming ones are listed below so the demo doesn't need a calendar change, and an agent can collect early. Pickups can only be booked from tomorrow, so with nothing due today the header says how many are coming up instead of showing an empty box.
- **Refund trigger.** The refund is created automatically when the item reaches Restocked or Scrapped. The steps are: QC grade A or C, or the re-inspection result.
- **Refunded → Closed.** The customer closes the return with "Got it, close this return" once the refund has arrived. Nothing else in the spec says who closes it.
- **"Wrong item" vs fraud.** For the reason "Wrong item", a mismatch confirms the customer's claim (full refund), so it is not treated as fraud. For any other reason, a mismatch means suspected fraud.
- **Re-inspection grades.** On a recheck the inspector picks **B** (repair passed: restocked, 70%) or **C** (failed: scrapped, 0%, unless the damaged/wrong-item exception applies).
- **Refund base.** Base = unit price × quantity of the returned order item. Returns cover a whole order line.
- **Inventory actions.** Grade A → *Restocked*. Grade B that passes the recheck → *Refurbished*. Anything scrapped → *Scrapped*. The warehouse 3D stacks count units (quantity), not returns.
- **Suggested grade** (QC page; it can be overridden): visible damage with broken packaging → C; any damage, broken packaging or missing tags → B; otherwise A.
- **Photo checks.** Extension (png/jpg/jpeg/webp), size (3 MB), and the file's first bytes, so a renamed file is refused. Files are stored under `static/uploads/` with random names.
- **Currency.** Shown as ₹ with Indian digit grouping (₹1,23,456).
- **Product images.** `products.image_url` holds a placeholder key such as `placeholder:audio`. Each category has an inline SVG line drawing.
- **Lenis smooth scroll** is not used. The flow section uses CSS `position: sticky` with ScrollTrigger scrubbing, which behaves well on mobile. Lenis would only add risk there.
- **One WebGL renderer per page.** The hero and the "How a return flows" section share one sticky canvas, so the landing page has a single renderer.
- **Stamp moment timing.** On the QC page the form is submitted after the ~0.9 s stamp animation, as the spec asks ("play the stamp moment, then continue"). With reduced motion the animation is skipped and the form submits immediately.
- **Extra service and script files.** Besides the four service files the spec lists, there are `services/returns.py` (one function per workflow action), `services/stats.py` (dashboard and landing numbers), `services/uploads.py` (photo checks) and `services/handoff.py` (who is next, for the handoff card), so route handlers stay thin.

## Where things are

```
app.py               app factory, error pages, template filters
config.py            settings and every business-rule constant
models.py            the 11 tables
seed.py              demo data, pushed through the real services
services/            all business logic (state machine, eligibility, refund, flags, workflow, handoff)
blueprints/          thin route handlers, one per role, plus the API
templates/           Jinja templates (base, macros, handoff card, landing, one folder per role)
static/css/          main.css (design system) and motion.css (animations, reduced motion)
static/js/           main.js, cursor, tilt, transitions, scenes/ (3D), fx/ (stamp, burst, counters), lib/webgl.js
tests/               pytest suite
docs/                ER diagram and UML mapping
```

## Presentation

`/ppt` (the **PPT** link in the top bar) is an 18-slide deck about the project from a software engineering point of view: project planning & management (vision, scope, incremental process, risks), functional and non-functional requirements, use case diagram, class diagram, DFD level 0 and level 1, activity diagram, two sequence diagrams (QC grade and refund; handing a return to the next desk), state diagram, layered architecture, and the path of one click from the UI down to the database. Use the arrow keys, click or swipe to move; **Present** (or `F`) goes full screen; **Save as PDF** prints one slide per page. A ready copy is in [docs/ReturnLoop-presentation.pdf](docs/ReturnLoop-presentation.pdf). The diagrams are drawn by Mermaid (loaded from jsdelivr) except the use case and activity diagrams, which are hand-drawn SVG.

## Team page

`/team` (the **Team** link in the top bar, for every role) introduces Chirag Seervi, Anshuman Singh and Aryan Singh. Up to 9,000 particles (3,600 on phones, fewer on low-power machines) start as a knotted loop. As you scroll they burst apart and re-form into each member's first name, and end as three interlocked rings. Your cursor (or finger) parts and swirls the particles around it, and clicking (or tapping) the page or a member's stamp shakes them loose. The morphing runs in a vertex shader on the GPU. Each member has a "crew manifest" card with a departure-board name scramble. Names and roles live in `config.TEAM`; edit them there.

## Accessibility and performance notes

- `prefers-reduced-motion` turns off particles, parallax, tilt, page transitions, shakes and the stamp animation. The 3D scenes then draw single still frames.
- Every scene goes through `lib/webgl.js`. It checks WebGL support, caps the pixel ratio (1.75 desktop, 1.25 mobile), pauses when the canvas is off-screen or the tab is hidden, halves the particles if the frame rate stays under 40 fps for 2 seconds, and disposes everything on page exit.
- Agent, QC queue, refurbisher and warehouse-receive pages load no 3D.
- **Light / dark mode:** the sun/moon button at the right of the top bar switches theme. It follows the system setting until you pick one, then remembers your choice (applied before the page draws, so there's no flash). The landing and team pages are dark in both themes; the presentation slides and the big shipping labels stay paper-white so they print properly.
- Status badges always carry their text. Focus rings are visible. Every control works from the keyboard, and tap targets are at least 44 px.
