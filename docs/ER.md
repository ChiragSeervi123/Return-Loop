# ReturnLoop: entity-relationship diagram

The schema has 11 tables (see [models.py](../models.py)). Staff (agents, inspectors, technicians) are not stored in a table. They are listed in `config.STAFF`, so `agent_id`, `inspector_id` and `technician_id` are plain integers, not foreign keys.

```mermaid
erDiagram
    CUSTOMERS ||--o{ ORDERS : places
    CUSTOMERS ||--o{ RETURN_REQUESTS : raises
    ORDERS ||--|{ ORDER_ITEMS : contains
    PRODUCTS ||--o{ ORDER_ITEMS : "is bought as"
    ORDER_ITEMS ||--o{ RETURN_REQUESTS : "is returned in"
    RETURN_REQUESTS ||--o{ PICKUPS : "is collected by"
    RETURN_REQUESTS ||--o{ QC_REPORTS : "is inspected in"
    RETURN_REQUESTS ||--o{ REFURBISH_JOBS : "is repaired in"
    RETURN_REQUESTS ||--o| REFUNDS : "is paid by"
    RETURN_REQUESTS ||--o{ STATUS_HISTORY : "is logged in"
    RETURN_REQUESTS ||--o{ INVENTORY_LOG : "ends up in"
    PRODUCTS ||--o{ INVENTORY_LOG : "is counted in"

    CUSTOMERS {
        int id PK
        string name
        string email UK
        string phone
        string address
        datetime created_at
    }
    PRODUCTS {
        int id PK
        string name
        string category
        float price
        string image_url "placeholder key"
        bool is_returnable
    }
    ORDERS {
        int id PK
        int customer_id FK
        datetime order_date
        datetime delivered_at
        float total
    }
    ORDER_ITEMS {
        int id PK
        int order_id FK
        int product_id FK
        int quantity
        float unit_price
    }
    RETURN_REQUESTS {
        int id PK
        string return_code UK "RL-2026-0001"
        int order_item_id FK
        int customer_id FK "indexed"
        string reason "enum"
        string comment
        string photo_path
        string status "enum, indexed"
        string refund_status
        bool flagged_fraud
        datetime created_at
        datetime updated_at
    }
    PICKUPS {
        int id PK
        int return_id FK
        int agent_id "config.STAFF"
        date slot_date
        string slot_window "Morning / Afternoon / Evening"
        int attempt_no
        string outcome "Pending / Picked / Absent"
        string notes
    }
    QC_REPORTS {
        int id PK
        int return_id FK
        int inspector_id "config.STAFF"
        bool packaging_intact
        bool tags_attached
        bool item_matches_order
        bool visible_damage
        string grade "A / B / C"
        string remarks
        bool is_recheck
        datetime created_at
    }
    REFURBISH_JOBS {
        int id PK
        int return_id FK
        int technician_id "config.STAFF"
        string status "Open / Repaired"
        string notes
        datetime created_at
        datetime completed_at
    }
    REFUNDS {
        int id PK
        int return_id FK,UK "one refund per return"
        float base_amount
        int grade_percent
        float pickup_fee
        float final_amount
        string status
        datetime created_at
    }
    INVENTORY_LOG {
        int id PK
        int product_id FK
        int return_id FK
        string action "Restocked / Refurbished / Scrapped"
        int quantity
        datetime created_at
    }
    STATUS_HISTORY {
        int id PK
        int return_id FK "indexed"
        string from_status
        string to_status
        string actor_role
        string actor_name
        string note
        datetime created_at
    }
```

## Notes

- **Indexes:** `return_requests.status`, `return_requests.customer_id` and `status_history.return_id`, as the spec requires. The unique columns (`customers.email`, `return_requests.return_code`, `refunds.return_id`) are also indexed.
- **One refund per return:** `refunds.return_id` is `UNIQUE`, so the database enforces it as well as `services/refund.py`.
- **`return_requests.customer_id`** duplicates `orders.customer_id` (reachable through `order_items`). It is kept because the spec lists it, and it makes "my returns" and the frequent-returner count simple queries.
