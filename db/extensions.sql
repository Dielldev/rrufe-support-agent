-- extensions.sql : additions on top of schema.sql + seed.sql
--
-- Applied right after the seed on a fresh database, and exactly once to an
-- existing database (tracked with PRAGMA user_version, see lib/db/client.ts).
-- Every statement is idempotent, so running it twice changes nothing.
--
-- Policy rows here are "ON FILE" in .claude/skills/purchase-plans-refunds/SKILL.md.
-- The agent reads every row of `policies`, so a new row is enough for it to
-- answer that topic; no code change is needed unless the rule has to be computed.

-- ---------------------------------------------------------------------------
-- policies on file
-- ---------------------------------------------------------------------------
INSERT INTO policies (topic, rule_text, value) VALUES
('installments',
 'Installments are available: 3, 6 or 12 monthly payments with a Raiffeisen Bank or TEB card, in store or at online checkout. Approval and any interest are set by the bank.',
 '{"months":[3,6,12],"banks":["Raiffeisen Bank","TEB"]}'),
('payments',
 'We accept card, bank transfer and cash on delivery.',
 '["card","bank_transfer","cash_on_delivery"]'),
('delay_compensation',
 'A verified customer whose order is late or held by the carrier gets a voucher for 5% off their next order, valid for 30 days. One voucher per delayed order; it is not cash, not transferable and not combined with other vouchers.',
 '{"percent":5,"valid_days":30}')
ON CONFLICT (topic) DO NOTHING;

-- ---------------------------------------------------------------------------
-- vouchers   (issued by code only; one per order, enforced by the UNIQUE key)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vouchers (
    voucher_id  INTEGER PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL REFERENCES customers (customer_id) ON DELETE RESTRICT,
    order_id    INTEGER NOT NULL UNIQUE REFERENCES orders (order_id) ON DELETE RESTRICT,
    reason      TEXT NOT NULL CHECK (reason IN ('delivery_delay')),
    kind        TEXT NOT NULL DEFAULT 'percent' CHECK (kind IN ('percent', 'free_shipping', 'gift_card')),
    percent     INTEGER CHECK (percent IS NULL OR percent BETWEEN 1 AND 50),
    amount_eur  REAL CHECK (amount_eur IS NULL OR (amount_eur > 0 AND amount_eur <= 10)),
    issued_at   TEXT NOT NULL CHECK (datetime(issued_at) IS NOT NULL),
    expires_on  TEXT NOT NULL CHECK (date(expires_on) IS expires_on),
    redeemed_at TEXT CHECK (redeemed_at IS NULL OR datetime(redeemed_at) IS NOT NULL),
    CHECK ((kind = 'percent') = (percent IS NOT NULL)),
    CHECK ((kind = 'gift_card') = (amount_eur IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_vouchers_customer ON vouchers (customer_id);

UPDATE products SET image_url = 'https://m.media-amazon.com/images/I/' || CASE product_id
    WHEN 1  THEN '61w0THscY3L'
    WHEN 2  THEN '5138DRkanoL'
    WHEN 3  THEN '61lvElgnZZL'
    WHEN 4  THEN '51rpbVmi9XL'
    WHEN 5  THEN '61UBYKeK1nL'
    WHEN 6  THEN '61s7W4UjnoL'
    WHEN 7  THEN '4109pOxZ3eL'
    WHEN 8  THEN '51PtFHUPjBL'
    WHEN 9  THEN '61PRvw0FyDL'
    WHEN 10 THEN '71blOLk9A6L'
END || '._AC_SL500_.jpg'
WHERE product_id BETWEEN 1 AND 10 AND image_url IS NULL;

INSERT INTO policies (topic, rule_text, value) VALUES
('order_changes',
 'Before an order ships (status pending or processing), the buyer can change the delivery address, remove items or lower a quantity, or cancel the order. Removing items from or cancelling an order already paid by card or bank transfer is completed by staff. Once an order has shipped, changes go to staff, who arrange them with the courier.',
 '{"statuses":["pending","processing"],"self_service_payments":["cash_on_delivery"],"max_address_changes":3}')
ON CONFLICT (topic) DO NOTHING;

CREATE TABLE IF NOT EXISTS order_changes (
    change_id     INTEGER PRIMARY KEY,
    order_id      INTEGER NOT NULL REFERENCES orders (order_id) ON DELETE CASCADE,
    customer_id   INTEGER NOT NULL REFERENCES customers (customer_id) ON DELETE RESTRICT,
    kind          TEXT NOT NULL CHECK (kind IN ('address', 'remove_item', 'cancel')),
    before_value  TEXT,
    after_value   TEXT,
    requested_via TEXT NOT NULL,
    changed_at    TEXT NOT NULL CHECK (datetime(changed_at) IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_order_changes_order ON order_changes (order_id);

INSERT INTO orders (order_id, customer_id, order_date, status, ship_address, payment_method) VALUES
(1051, 7, '2026-09-24', 'processing', 'Rr. Agim Ramadani 45, Prishtine', 'cash_on_delivery')
ON CONFLICT (order_id) DO NOTHING;

INSERT INTO order_items (item_id, order_id, product_id, qty, price, opened_flag) VALUES
(18, 1051, 4, 1, 129.00, 0),
(19, 1051, 9, 2,  39.90, 0)
ON CONFLICT (item_id) DO NOTHING;

UPDATE policies SET
    rule_text = 'A verified customer whose order is late or held by the carrier gets a voucher for their next order, valid for 30 days: 5% off; free shipping instead when the order is €300 or more and at least 3 days late; a €5 gift card instead when the order is €500 or more and at least 5 days late. One voucher per delayed order; it is not cash, not transferable and not combined with other vouchers.',
    value = '{"percent":5,"valid_days":30,"tiers":[{"reward":"free_shipping","min_days_late":3,"min_order_eur":300},{"reward":"gift_card","amount_eur":5,"min_days_late":5,"min_order_eur":500}]}'
WHERE topic = 'delay_compensation' AND value = '{"percent":5,"valid_days":30}';
