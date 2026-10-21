# ReturnLoop: Returns and Reverse-Logistics Centre

## 1. Goal and the experience I want
Build a complete, working, demo-ready web app for a college Software Engineering project. An e-commerce business uses it to handle product returns: request, pickup, quality check (QC), grading, refurbish/restock/scrap, refund. The backend code must be clean and simple enough for a second-year BTech student to explain in a viva.

The frontend must make people say "wow" in the first five seconds. It should be interactive, with real 3D, particles, tactile motion and visual effects, while feeling designed by a person with a point of view, NOT like a generic AI-generated template. Backend clarity and frontend flair are both required. Effects must never get in the way of usability.

## 2. Tech stack (fixed)
- Backend: Python 3.10+, Flask with Blueprints, Jinja2, SQLite via Flask-SQLAlchemy, pytest
- Frontend: plain CSS (one main stylesheet with CSS variables), vanilla JavaScript as ES modules. No React, no npm, no bundler
- 3D: Three.js (r160) loaded with an importmap from cdn.jsdelivr.net, including addons from examples/jsm where needed
- Motion: GSAP 3.12 with ScrollTrigger from cdnjs. Lenis smooth scroll from jsdelivr only if it behaves well on mobile, otherwise skip it
- Charts: Chart.js from CDN (admin only)
- Fonts (Google Fonts): Bricolage Grotesque (display), Instrument Sans (body), DM Mono (codes, labels, numbers)
- Must run with: pip install -r requirements.txt && python seed.py && python app.py
- No external image or 3D model files. Build all 3D objects procedurally (BoxGeometry, canvas-generated textures for tape, labels and barcodes). All illustration is inline SVG or CSS

## 3. Folder structure
returnloop/
  app.py, config.py, models.py, seed.py, requirements.txt, README.md
  services/ (state_machine.py, refund.py, eligibility.py, flags.py)
  blueprints/ (main.py, customer.py, agent.py, qc.py, refurbisher.py, warehouse.py, admin.py, api.py)
  templates/ (base.html, _macros.html, landing.html, one folder per role)
  static/css/ (main.css, motion.css)
  static/js/ (main.js, cursor.js, tilt.js, transitions.js, scenes/hero.js, scenes/track.js, scenes/crates.js, fx/stamp.js, fx/burst.js, fx/counters.js, lib/webgl.js)
  static/uploads/
  tests/
  docs/ER.md, docs/UML_MAPPING.md

## 4. Roles and access
Six roles: customer, agent, qc, refurbisher, warehouse, admin. No real login. A "Switch role / user" control in the navbar stores role and user id in the session. Each blueprint rejects the wrong role with a friendly 403 page. Seed three customers for demoing.

## 5. Database schema (fields)
- customers: id, name, email, phone, address, created_at
- products: id, name, category, price, image_url (placeholder), is_returnable (bool)
- orders: id, customer_id, order_date, delivered_at, total
- order_items: id, order_id, product_id, quantity, unit_price
- return_requests: id, return_code (e.g. RL-2026-0001), order_item_id, customer_id, reason (enum), comment, photo_path, status (enum), refund_status, flagged_fraud (bool), created_at, updated_at
- pickups: id, return_id, agent_id, slot_date, slot_window (Morning/Afternoon/Evening), attempt_no, outcome (Pending/Picked/Absent), notes
- qc_reports: id, return_id, inspector_id, packaging_intact, tags_attached, item_matches_order, visible_damage (bools), grade (A/B/C), remarks, is_recheck (bool), created_at
- refurbish_jobs: id, return_id, technician_id, status (Open/Repaired), notes, created_at, completed_at
- refunds: id, return_id, base_amount, grade_percent, pickup_fee, final_amount, status, created_at
- inventory_log: id, product_id, return_id, action (Restocked/Refurbished/Scrapped), quantity, created_at
- status_history: id, return_id, from_status, to_status, actor_role, actor_name, note, created_at
Indexes on return_requests.status, return_requests.customer_id, status_history.return_id.

## 6. Status flow (state machine)
Statuses: Requested, Pickup Scheduled, Picked Up, Received, Inspected, Refurbishing, Re-inspection, Restocked, Scrapped, Refunded, Closed, Rejected, Cancelled.
Valid transitions ONLY (anything else raises an error and shows a friendly message):
- Requested to Pickup Scheduled (customer schedules) or Rejected (failed eligibility)
- Pickup Scheduled to Picked Up (agent), to Pickup Scheduled (absent attempt 1, or reschedule), to Cancelled (2nd absent attempt)
- Picked Up to Received (warehouse marks arrival)
- Received to Inspected (QC submits grade) or Rejected (item does not match order, flagged_fraud = true)
- Inspected to Restocked (grade A), Refurbishing (grade B), Scrapped (grade C)
- Refurbishing to Re-inspection (refurbisher marks repaired)
- Re-inspection to Restocked (recheck passes) or Scrapped (recheck fails)
- Restocked or Scrapped to Refunded (refund created)
- Refunded to Closed
Every change goes through services/state_machine.py only: change_status(return, new_status, actor_role, actor_name, note). It validates the transition, writes status_history and updates updated_at in one DB transaction.

## 7. Business rules (all constants in config.py with comments)
- RETURN_WINDOW_DAYS = 7, counted from delivered_at
- Eligibility fails if: outside window, product not returnable, or an open return already exists for that order item
- Grade A: refund 100%, item Restocked
- Grade B: item Refurbishing; after recheck passes it is Restocked and refund is 70%
- Grade C: refund 0%, item Scrapped
- Exception: if reason is "Damaged" or "Wrong item" and the QC report confirms it (visible_damage true, or item_matches_order false for wrong item), the customer gets 100% regardless of grade; the item is still routed by grade
- PICKUP_FEE = 50 rupees, deducted only for reason "Changed my mind"
- MAX_PICKUP_ATTEMPTS = 2
- Frequent-returner flag: more than 3 return requests by one customer in the last 30 days sets a flag shown to admin (do not block the customer)
- At refund time, in ONE transaction: create the refund record AND write inventory_log
- Refund formula: final = max(0, base * grade_percent - pickup_fee). Store every component so the breakdown can be shown

## 8. Pages and routes (functionality plus the experience for each)

### Landing page: / (the showpiece)
A scroll-driven story, desktop and mobile:
1. Hero, full viewport, dark ink background, with the 3D "Loop" scene (section 10). Big headline in Bricolage Grotesque with a per-word masked reveal. One primary button "Start a return" and one secondary "Staff entry". Subtle scroll cue.
2. "How a return flows": pinned section; as the user scrolls, the 3D parcel advances through 5 steps (Request, Pickup, Check-in, Grade, Refund) while step text swaps with GSAP.
3. "Three grades, three fates": three large rubber stamps (A, B, C) slam in on scroll with a small screen shake and spark particles; each explains the outcome and refund percent.
4. A numbers strip with counting-up stats (use seeded real data from the database).
5. Closing call to action as a big shipping label.

### Customer
- /customer/orders: order cards styled as shipping-label slips (perforated edge, barcode strip, mono tracking text). Cards tilt in 3D on hover with a soft glare. "Return item" button only if eligible, otherwise a disabled badge saying why (window closed, not returnable, return already open)
- /customer/return/new?item=ID: reason as large selectable tiles (Damaged, Wrong item, Not as described, Changed my mind), comment (max 300 chars), photo upload with drag and drop and preview. Image types only (png/jpg/webp), max 3 MB
- /customer/return/<code>/schedule: date picker (tomorrow to +5 days) and slot chips (Morning/Afternoon/Evening), address confirmation
- /customer/returns: my returns list with status badges
- /customer/return/<code>: Track Return. A 3D parcel travels along a path with waypoints matching the progress steps; its position reflects the current status and it animates smoothly when the status changes (poll /api/return/<code>/status every 5 s). Drag to rotate the parcel. Below it: status history timeline and the refund breakdown (base, grade percent, pickup fee, final) with count-up animation

### Pickup Agent (phone-first, minimal effects)
- /agent/pickups: today's pickups sorted by slot (address, phone, item) as big tappable cards
- /agent/pickup/<id>: "Mark picked up" and "Customer absent" buttons with confirmation modal

### QC Inspector
- /qc/queue: returns in Received or Re-inspection, search by return code
- /qc/inspect/<code>: checklist toggles (packaging intact, tags attached, item matches order, visible damage), remarks, and grade chosen with three big stamp buttons A / B / C. Show a suggested grade from the checklist but allow override. On submit play the stamp moment (section 10), then continue. If "item matches order" is unchecked, reject as suspected fraud after a confirmation modal

### Refurbisher
- /refurb/jobs: open repair jobs; "Mark repaired" sends the item to Re-inspection

### Warehouse Manager
- /warehouse/receive: Picked Up items with "Mark received at centre"
- /warehouse/inventory: three animated 3D crate stacks (Restocked, Refurbished, Scrapped) whose heights reflect counts, plus a filterable inventory_log table

### Admin
- /admin/dashboard: stat cards with count-up, a Chart.js bar chart of return reasons and a doughnut of grades A/B/C (brand colours, animated on view), flagged customers table

### API
- /api/return/<code>/status returns JSON with status, step index and updated_at (customer-owned returns only)

## 9. Visual identity (this is what makes it NOT look AI-made)
Concept: "mailroom meets control tower". Warm kraft paper, ink black, signal orange, with tactile logistics details.

Colours (CSS variables): --paper #F6F1E7, --kraft #E9DFCB, --ink #14110F, --orange #FF5B1F, --steel #6B6A66, --line #D9CFBA. Grades: A moss #2F7D4F on #DCEBDD, B amber #D99A1E on #FBEBC8, C brick #B3392B on #F6D9D4. Hero and dark sections use --ink with an orange glow.

Type: Bricolage Grotesque for headings (tight tracking, large, confident scale contrast), Instrument Sans for body, DM Mono for codes, labels, prices and status text. Use a dramatic size scale (hero up to ~9vw on desktop).

Details that give it character:
- Subtle paper grain overlay (inline SVG feTurbulence at about 4% opacity)
- Shipping-label cards: perforated edges (radial-gradient notches), barcode strips (repeating-linear-gradient), mono tracking codes
- Rubber stamps: rotated a few degrees, slightly rough edges using an SVG displacement filter, ink-style colour
- Tape strips, dashed cut-lines, corner notches via clip-path (not every corner is a 12px rounded rectangle)
- Asymmetric layouts, overlapping elements, and oversized numerals as design elements
- Short, dry, human microcopy (for example "Changed your mind? You have 7 days.") and no filler text

Do NOT use: purple/blue gradients, glassmorphism, emoji as icons, identical three-column feature-card rows, stock icon-in-circle grids, everything centred, "Welcome to..." headlines, lorem ipsum, generic stock illustrations. Icons must be inline SVG drawn in one consistent stroke style.

## 10. 3D, particles and motion spec

Shared rules: one WebGL renderer per page, created through lib/webgl.js, which feature-detects WebGL and falls back to a static CSS version of the section if unavailable. Cap device pixel ratio at 1.75 (1.25 on mobile). Pause rendering when the canvas is off-screen (IntersectionObserver) or the tab is hidden. Dispose geometries, materials and textures on teardown.

A. Hero scene "The Loop" (hero.js)
- A closed CatmullRomCurve3 track (a rounded loop with a gentle twist) drawn as a thin glowing orange ribbon with soft emissive material
- 12 to 16 procedurally built kraft parcels (BoxGeometry; canvas texture with tape strip, label rectangle, tiny barcode; slight random scale and tilt) slide along the loop with a slow bobbing motion
- A "QC gate": an orange arch the parcels pass through. As each parcel passes, a scanner beam (thin additive plane) sweeps it, the parcel flashes green, amber or brick (matching the grades), and a small spark burst fires
- Particles: about 1200 floating dust motes on desktop (350 on mobile) as Points with additive blending and slow drift, plus orange sparks at the gate
- Camera: mouse parallax with lerp easing; on scroll the camera dollies and orbits slightly using ScrollTrigger
- Fog and soft rim lighting for depth; no heavy post-processing

B. How-it-flows scene (reuses hero.js module)
- Pinned scrub; the camera follows one highlighted parcel through the five steps. Simplify if needed, but it must be scroll-linked and smooth.

C. Track scene (track.js)
- Compact canvas (about 360px high on mobile, 480px on desktop). A parcel on a path with 6 waypoint markers labelled in DM Mono. Position maps to status; changes animate with easing; pointer drag rotates the parcel (limit rotation, ease back).

D. Crates scene (crates.js)
- Three stacks of boxes (Restocked green, Refurbished amber, Scrapped brick). Stack height equals counts (capped for display). Slow idle rotation, hover tooltip with the exact number. Drop-in animation on load.

E. Stamp moment (fx/stamp.js, fx/burst.js)
- When QC submits: a full-screen overlay; a giant stamp of the chosen grade scales from 2.2x to 1x with a fast ease-in, impacts with a 200ms screen shake, ink-splat spark burst in the grade colour (canvas 2D or Three Points), then fades into the result. On mobile also call navigator.vibrate(30) if available.

F. Micro-interactions (desktop pointer: fine only unless noted)
- Custom cursor: small orange dot with a lagging ring that grows over interactive elements (cursor.js)
- Tilt-on-hover with glare for cards (tilt.js, about 40 lines, no library)
- Magnetic primary buttons
- Page transitions (transitions.js): a kraft-paper flap wipe via clip-path on link navigation (about 350ms), and the new page's intro animation plays on load
- Role switch: the role chip flips with a CSS 3D rotateX
- Toasts as shipping-label slips sliding in
- Count-up numbers (fx/counters.js), triggered when scrolled into view
- Skeleton loaders and friendly empty states with an inline SVG drawing (for example an empty open box)

## 11. Performance, accessibility and robustness guardrails
- Respect prefers-reduced-motion: disable particles, parallax, tilt, page transitions and shake, and show calm static equivalents
- Operational pages used on phones (agent, QC queue, refurbisher, warehouse receive) stay light: no 3D scenes there, only simple transitions. The QC stamp moment is the one exception
- Target 60 fps on a mid laptop and 30+ on mid phones. If the frame rate drops below about 40 for 2 seconds, automatically halve the particle count
- Text contrast meets WCAG AA. Visible focus rings. All flows work with keyboard only. Colour is never the only signal (badges also carry text)
- Layout works at 360px width. No horizontal scroll. Tap targets at least 44px
- Effects must never block clicks or delay form submission

## 12. Edge cases
- Returning a product twice, or after the window closes
- Wrong file type or oversized upload
- Customer absent twice, which cancels the request and explains why
- Refurbish recheck failing, which converts the item to grade C
- Return code that does not exist (404 page) or belongs to another customer
- Double-click on submit (disable the button, and guard on the server with the state machine)
- A refund must never be created twice for the same return
- WebGL not available, which uses the static fallback without errors

## 13. Seed data (seed.py)
3 customers, 10 products (2 non-returnable), 12 delivered orders with delivery dates spread across 1 to 14 days ago, 1 customer already with 3 recent returns (so the flag shows), and about 8 returns pre-created in varied states across the flow so every dashboard, chart and 3D scene has real content on first run.

## 14. Tests (pytest)
- state_machine: every valid transition passes, at least 5 invalid ones fail
- refund: grade A/B/C, the damaged exception, pickup fee, the max(0, ...) floor
- eligibility: inside window, outside window, non-returnable, duplicate request
- flags: 3 returns does not flag, 4 returns flags
- api: status endpoint returns correct data and refuses other customers' returns
All tests must pass before finishing.

## 15. Documentation to generate
- README.md: setup, role-to-pages table, business rules table, an "Assumptions" section for decisions you made yourself, and a step-by-step demo script (customer returns an item, agent picks it up, warehouse receives it, QC grades B with the stamp moment, refurbisher repairs, QC rechecks, refund appears, admin dashboard updates)
- docs/ER.md: a Mermaid erDiagram of the schema
- docs/UML_MAPPING.md: a table mapping each part of the app to UML diagrams (roles to use case actors, status flow to state diagram, models to class diagram, the demo flow to swimlane, sequence and activity diagrams)

## 16. Rules for how you work
1. Do NOT stop to ask for approval or confirmation. Start building immediately and work through all stages in one run.
2. If something is ambiguous, choose the most sensible option, note it in README.md under "Assumptions", and keep going.
3. Build in stages and commit after each: (a) models, config, services and tests; (b) seed data; (c) customer flow with working plain UI; (d) agent, warehouse, QC and refurbisher flows; (e) admin; (f) design system, landing page and all 3D scenes and effects; (g) polish, docs, edge cases.
4. After each stage, run the app and the tests and fix every failure before continuing.
5. Put all business logic in services/ and config.py, not in route handlers or templates.
6. If Playwright and a headless browser can be installed, use them to screenshot the landing page, the track page, the QC page and the admin page at 360px and 1440px widths, then review the screenshots critically. Check for broken layouts, overlapping text, unreadable contrast and anything that looks like a generic AI template (see section 9, "Do NOT use"), and fix what you find. If screenshots are not possible, still check the HTML and CSS carefully for these issues.
7. Before finishing, run the full demo script from README.md end to end and fix anything that breaks.
8. Do not add features outside this spec.
9. At the end, give a short summary: what is done, what assumptions you made, and anything I should double check.