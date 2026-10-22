# ReturnLoop: mapping the app to UML diagrams

This table shows where each UML diagram comes from in the code, so a diagram can be drawn (or checked) straight from the source.

| UML diagram | What it shows | Where it comes from in the app |
|---|---|---|
| **Use case diagram** | Actors and what each can do | The six roles are the actors (`config.ROLES`). Their use cases are the routes in each blueprint (below). |
| **Class diagram** | Entities, attributes, associations | `models.py`: 11 classes with their columns and `db.relationship` links. The service modules (`services/*.py`) can be drawn as control classes. See also [ER.md](ER.md). |
| **State machine diagram** | Lifecycle of a return | `services/state_machine.py`: the 13 statuses (`ALL_STATUSES`) and the `TRANSITIONS` table. Each transition's trigger is the workflow function that calls `change_status()`. |
| **Activity diagram** | The end-to-end return process, with decisions | `services/returns.py`: the decisions are the eligibility check, absent attempts, fraud check, grade routing, and recheck pass/fail. |
| **Swimlane (activity with partitions)** | The same process split by who does each step | One lane per role: Customer → Agent → Warehouse → QC → Refurbisher → QC → System (refund). This is the README demo script. |
| **Sequence diagram** | Messages between objects for one scenario | For example, "QC submits grade A": Browser → `qc.inspect` → `submit_inspection()` → `change_status()` ×2 → `issue_refund()` → DB commit → redirect. |
| **Component / deployment** (optional) | How the pieces fit | Flask app (blueprints and services) + SQLite file + static assets. The browser loads Three.js, GSAP and Chart.js from CDNs. |

## Use cases per actor

| Actor | Use cases | Route / function |
|---|---|---|
| Customer | View orders and eligibility | `GET /customer/orders` → `check_eligibility()` |
| | Request a return (reason, comment, photo) | `POST /customer/return/new` → `create_return()`, `save_photo()` |
| | Schedule / reschedule a pickup | `POST /customer/return/<code>/schedule` → `schedule_pickup()` |
| | Track a return (live) | `GET /customer/return/<code>`, `GET /api/return/<code>/status` |
| | Close a refunded return | `POST /customer/return/<code>/close` → `close_return()` |
| Pickup agent | See today's pickups | `GET /agent/pickups` |
| | Mark picked up / customer absent | `POST /agent/pickup/<id>` → `mark_picked_up()` / `mark_absent()` |
| Warehouse manager | Receive a parcel | `POST /warehouse/receive/<code>` → `mark_received()` |
| | View inventory outcomes | `GET /warehouse/inventory` |
| QC inspector | Search the queue | `GET /qc/queue?q=` |
| | Inspect and grade (or reject as fraud) | `POST /qc/inspect/<code>` → `submit_inspection()` |
| | Re-inspect a repaired item | same route, when status is Re-inspection |
| Refurbisher | Mark a job repaired | `POST /refurb/jobs/<id>/repaired` → `mark_repaired()` |
| Admin | View dashboard and flagged customers | `GET /admin/dashboard` → `dashboard_stats()`, `flagged_customers()` |
| All | Switch role / user | `POST /switch` |

## State machine (copy into a state diagram)

```mermaid
stateDiagram-v2
    [*] --> Requested : customer requests (eligible)
    Requested --> PickupScheduled : customer books slot
    Requested --> Rejected : fails eligibility
    PickupScheduled --> PickupScheduled : reschedule / absent (attempt 1)
    PickupScheduled --> PickedUp : agent collects
    PickupScheduled --> Cancelled : absent (attempt 2)
    PickedUp --> Received : warehouse checks in
    Received --> Inspected : QC grades
    Received --> Rejected : item mismatch (fraud)
    Inspected --> Restocked : grade A
    Inspected --> Refurbishing : grade B
    Inspected --> Scrapped : grade C
    Refurbishing --> Reinspection : repaired
    Reinspection --> Restocked : recheck passes
    Reinspection --> Scrapped : recheck fails
    Restocked --> Refunded : refund + inventory log
    Scrapped --> Refunded : refund + inventory log
    Refunded --> Closed : customer confirms
    Closed --> [*]
    Rejected --> [*]
    Cancelled --> [*]
```

## Sequence: QC grades a return B, then rechecks it

```mermaid
sequenceDiagram
    actor QC as QC inspector
    participant R as qc blueprint
    participant W as services.returns
    participant S as services.state_machine
    participant F as services.refund
    participant DB as SQLite
    QC->>R: POST /qc/inspect/RL-2026-0010 (checklist, grade B)
    R->>W: submit_inspection(ret, checklist, "B")
    W->>S: change_status(Received → Inspected)
    W->>S: change_status(Inspected → Refurbishing)
    W->>DB: insert qc_report, refurbish_job, 2× status_history; commit
    R-->>QC: redirect to queue + toast
    Note over QC,DB: refurbisher marks repaired → Re-inspection
    QC->>R: POST /qc/inspect/RL-2026-0010 (grade B = passed)
    R->>W: submit_inspection(ret, checklist, "B")
    W->>S: change_status(Re-inspection → Restocked)
    W->>F: issue_refund(ret, "Refurbished")
    F->>F: calculate_refund(base, B, reason) → 70%
    F->>S: change_status(Restocked → Refunded)
    F->>DB: insert refund + inventory_log + history; ONE commit
    R-->>QC: redirect + toast
```

## Activity / swimlane: the demo flow

```mermaid
flowchart TB
    subgraph Customer
      A1[Open orders] --> A2{Eligible?}
      A2 -- no --> A3[See reason badge]
      A2 -- yes --> A4[Request return + photo] --> A5[Book pickup slot]
    end
    subgraph Agent
      B1{Customer home?}
      B1 -- yes --> B2[Mark picked up]
      B1 -- no, 1st time --> B3[Rebook next day] --> B1
      B1 -- no, 2nd time --> B4[Cancel return]
    end
    subgraph Warehouse
      C1[Mark received]
    end
    subgraph QC
      D1{Item matches order?}
      D1 -- no --> D2[Reject as fraud]
      D1 -- yes --> D3{Grade}
      D3 -- A --> D4[Restock]
      D3 -- C --> D5[Scrap]
      D6{Recheck passes?}
      D6 -- yes --> D4
      D6 -- no --> D5
    end
    subgraph Refurbisher
      E1[Repair, mark repaired]
    end
    subgraph System
      F1[Create refund + inventory log in one transaction] --> F2[Refunded]
    end
    A5 --> B1
    B2 --> C1 --> D1
    D3 -- B --> E1 --> D6
    D4 --> F1
    D5 --> F1
```
