-- schema.sql : customer-inbox AI agent, Pristina electronics shop
--
-- Conventions
--   * Dates      : TEXT 'YYYY-MM-DD'            (validated by CHECK)
--   * Timestamps : TEXT 'YYYY-MM-DD HH:MM:SS'   (UTC when defaulted)
--   * Languages  : 'sq' (Albanian) | 'en' (English). Extend the CHECKs to add more.
--   * A shipment's delivery date is date(last_update) when tracking_status = 'delivered'.
--   * Foreign keys are per-connection in SQLite: run `PRAGMA foreign_keys = ON`
--     on every connection you open (setup_db.py does).

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
    customer_id      INTEGER PRIMARY KEY,
    name             TEXT NOT NULL CHECK (length(trim(name)) > 0),
    phone            TEXT CHECK (phone IS NULL OR length(trim(phone)) > 0),
    email            TEXT CHECK (email IS NULL OR length(trim(email)) > 0),
    instagram_handle TEXT CHECK (instagram_handle IS NULL
                                 OR length(ltrim(trim(instagram_handle), '@')) > 0),
    language         TEXT NOT NULL DEFAULT 'sq' CHECK (language IN ('sq', 'en')),
    -- every customer must be reachable on at least one channel
    CHECK (phone IS NOT NULL OR email IS NOT NULL OR instagram_handle IS NOT NULL)
);

-- Sender matching (privacy check) relies on each identifier belonging to ONE
-- customer, so enforce uniqueness on the normalised form.
CREATE UNIQUE INDEX ux_customers_phone
    ON customers (replace(replace(replace(phone, ' ', ''), '-', ''), '+', ''));
CREATE UNIQUE INDEX ux_customers_email
    ON customers (lower(email));
CREATE UNIQUE INDEX ux_customers_instagram
    ON customers (ltrim(lower(instagram_handle), '@'));

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
CREATE TABLE products (
    product_id INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    category   TEXT NOT NULL CHECK (category IN ('laptop', 'headphones', 'phone', 'charger')),
    price      REAL NOT NULL CHECK (price >= 0)          -- EUR
);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
    order_id       INTEGER PRIMARY KEY,
    customer_id    INTEGER NOT NULL REFERENCES customers (customer_id) ON DELETE RESTRICT,
    order_date     TEXT NOT NULL CHECK (date(order_date) IS order_date),
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processing', 'shipped',
                                     'delivered', 'cancelled', 'returned')),
    ship_address   TEXT NOT NULL CHECK (length(trim(ship_address)) > 0),
    payment_method TEXT NOT NULL
                   CHECK (payment_method IN ('cash_on_delivery', 'card', 'bank_transfer'))
);

-- ---------------------------------------------------------------------------
-- order_items   (price = unit price at time of purchase)
-- ---------------------------------------------------------------------------
CREATE TABLE order_items (
    item_id     INTEGER PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES orders (order_id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products (product_id) ON DELETE RESTRICT,
    qty         INTEGER NOT NULL CHECK (qty > 0),
    price       REAL NOT NULL CHECK (price >= 0),
    opened_flag INTEGER NOT NULL DEFAULT 0 CHECK (opened_flag IN (0, 1)),
    UNIQUE (order_id, product_id)
);

-- ---------------------------------------------------------------------------
-- shipments
-- ---------------------------------------------------------------------------
CREATE TABLE shipments (
    shipment_id       INTEGER PRIMARY KEY,
    order_id          INTEGER NOT NULL REFERENCES orders (order_id) ON DELETE CASCADE,
    carrier           TEXT NOT NULL,
    shipped_date      TEXT NOT NULL CHECK (date(shipped_date) IS shipped_date),
    expected_min_date TEXT NOT NULL CHECK (date(expected_min_date) IS expected_min_date),
    expected_max_date TEXT NOT NULL CHECK (date(expected_max_date) IS expected_max_date),
    tracking_status   TEXT NOT NULL
                      CHECK (tracking_status IN ('in_transit', 'out_for_delivery', 'delivered',
                                                 'failed_delivery', 'returned_to_sender')),
    last_update       TEXT NOT NULL CHECK (datetime(last_update) IS NOT NULL),
    CHECK (expected_min_date <= expected_max_date)
);

-- ---------------------------------------------------------------------------
-- policies   (the agent may only quote what is in this table)
-- ---------------------------------------------------------------------------
CREATE TABLE policies (
    policy_id INTEGER PRIMARY KEY,
    topic     TEXT NOT NULL UNIQUE,
    rule_text TEXT NOT NULL,
    value     TEXT                                        -- machine-readable form of the rule
);

-- ---------------------------------------------------------------------------
-- conversations   (customer_id is NULL when the sender is not a known customer)
-- ---------------------------------------------------------------------------
CREATE TABLE conversations (
    conv_id       INTEGER PRIMARY KEY,
    customer_id   INTEGER REFERENCES customers (customer_id) ON DELETE SET NULL,
    sender_handle TEXT NOT NULL CHECK (length(trim(sender_handle)) > 0),
    channel       TEXT NOT NULL CHECK (channel IN ('email', 'instagram', 'viber')),
    message_text  TEXT NOT NULL,
    language      TEXT NOT NULL CHECK (language IN ('sq', 'en')),
    received_at   TEXT NOT NULL CHECK (datetime(received_at) IS NOT NULL),
    sentiment     TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'angry'))
);

-- ---------------------------------------------------------------------------
-- agent_log   (one row per agent decision; audit trail, so no cascading deletes)
-- ---------------------------------------------------------------------------
CREATE TABLE agent_log (
    log_id     INTEGER PRIMARY KEY,
    conv_id    INTEGER NOT NULL REFERENCES conversations (conv_id) ON DELETE RESTRICT,
    intent     TEXT NOT NULL,
    language   TEXT NOT NULL CHECK (language IN ('sq', 'en')),
    order_id   INTEGER REFERENCES orders (order_id) ON DELETE SET NULL,
    action     TEXT NOT NULL CHECK (action IN ('auto_reply', 'escalate')),
    reason     TEXT NOT NULL,
    reply_text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (datetime(created_at) IS NOT NULL),
    -- an auto_reply without text is a bug; an escalate may carry a holding message or none
    CHECK (action <> 'auto_reply' OR reply_text IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- escalations   (hand-offs to human staff)
-- ---------------------------------------------------------------------------
CREATE TABLE escalations (
    escalation_id INTEGER PRIMARY KEY,
    conv_id       INTEGER NOT NULL REFERENCES conversations (conv_id) ON DELETE RESTRICT,
    priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    summary       TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')) CHECK (datetime(created_at) IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- Indexes for the lookups the agent does on every message
-- ---------------------------------------------------------------------------
CREATE INDEX ix_orders_customer        ON orders (customer_id);
CREATE INDEX ix_order_items_order      ON order_items (order_id);
CREATE INDEX ix_shipments_order        ON shipments (order_id);
CREATE INDEX ix_conversations_customer ON conversations (customer_id, received_at);
CREATE INDEX ix_conversations_sender   ON conversations (sender_handle);
CREATE INDEX ix_agent_log_conv         ON agent_log (conv_id);
CREATE INDEX ix_escalations_conv       ON escalations (conv_id);
CREATE INDEX ix_escalations_status     ON escalations (status);
