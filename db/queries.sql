-- queries.sql : helper queries for the customer-inbox agent
--
-- Each query starts with a "-- name: <identifier>" marker line (setup_db.py splits on
-- these) and uses named parameters (:order_id etc.).
--
--   :today   'YYYY-MM-DD'. The seed data is anchored to 2026-09-24; in production
--            pass date('now').
--   In the sqlite3 shell:  .parameter set :order_id 1048   (see `.help parameter`)
--
-- PRIVACY: order_lookup returns the shipping address and customer name. Run
-- does_sender_match_order_owner first and only use those fields when it returns 1.


-- name: order_lookup
-- Params: :order_id. One row per shipment (or one row with NULL shipment columns if
-- the order has not shipped). No row = unknown order.
SELECT o.order_id,
       o.order_date,
       o.status,
       o.payment_method,
       o.ship_address,
       c.customer_id,
       c.name     AS customer_name,
       c.language AS customer_language,
       (SELECT GROUP_CONCAT(p.name || ' x' || oi.qty, '; ')
          FROM order_items oi
          JOIN products p ON p.product_id = oi.product_id
         WHERE oi.order_id = o.order_id)                   AS items,
       (SELECT ROUND(SUM(oi.qty * oi.price), 2)
          FROM order_items oi
         WHERE oi.order_id = o.order_id)                   AS order_total,
       s.carrier,
       s.shipped_date,
       s.expected_min_date,
       s.expected_max_date,
       s.tracking_status,
       s.last_update
FROM orders o
JOIN customers c ON c.customer_id = o.customer_id
LEFT JOIN shipments s ON s.order_id = o.order_id
WHERE o.order_id = :order_id;


-- name: is_shipment_late
-- Params: :order_id, :today.
-- is_late: 1 = late, 0 = on time, NULL = no shipment yet (or unknown order -> no row).
-- Not delivered : late when today is after expected_max_date.
-- Delivered     : late when it arrived after expected_max_date.
-- days_late is in calendar days.
WITH s AS (
    SELECT o.order_id,
           sh.shipment_id,
           sh.tracking_status,
           sh.expected_max_date,
           CASE WHEN sh.tracking_status = 'delivered' THEN date(sh.last_update)
                ELSE date(:today)
           END AS compared_on
    FROM orders o
    LEFT JOIN shipments sh ON sh.order_id = o.order_id
    WHERE o.order_id = :order_id
)
SELECT order_id,
       shipment_id,
       tracking_status,
       expected_max_date,
       CASE WHEN shipment_id IS NULL THEN NULL
            WHEN compared_on > expected_max_date THEN 1
            ELSE 0
       END AS is_late,
       CASE WHEN shipment_id IS NULL THEN NULL
            ELSE MAX(0, CAST(julianday(compared_on) - julianday(expected_max_date) AS INTEGER))
       END AS days_late
FROM s;


-- name: return_eligibility
-- Params: :order_id, :today. One row per order item (opened_flag is per item).
-- Rule comes from policies.returns: within `value` days of delivery AND unopened.
-- Delivery date = date(last_update) of the shipment whose tracking_status = 'delivered'.
-- Day 30 still counts as inside the window. No rows = unknown order / no items.
WITH d AS (
    SELECT o.order_id,
           (SELECT MAX(date(sh.last_update))
              FROM shipments sh
             WHERE sh.order_id = o.order_id
               AND sh.tracking_status = 'delivered') AS delivered_date
    FROM orders o
    WHERE o.order_id = :order_id
),
x AS (
    SELECT oi.order_id,
           oi.item_id,
           p.name AS product,
           oi.opened_flag,
           d.delivered_date,
           CAST(julianday(date(:today)) - julianday(d.delivered_date) AS INTEGER) AS days_since_delivery,
           (SELECT CAST(value AS INTEGER) FROM policies WHERE topic = 'returns')  AS window_days
    FROM d
    JOIN order_items oi ON oi.order_id = d.order_id
    JOIN products p     ON p.product_id = oi.product_id
)
SELECT order_id,
       item_id,
       product,
       delivered_date,
       days_since_delivery,
       window_days,
       opened_flag,
       CASE WHEN delivered_date IS NULL OR window_days IS NULL THEN 0
            WHEN days_since_delivery <= window_days AND opened_flag = 0 THEN 1
            ELSE 0
       END AS eligible,
       CASE WHEN window_days IS NULL THEN 'no_return_policy'
            WHEN delivered_date IS NULL THEN 'not_delivered_yet'
            WHEN days_since_delivery > window_days AND opened_flag = 1 THEN 'window_expired_and_item_opened'
            WHEN days_since_delivery > window_days THEN 'window_expired'
            WHEN opened_flag = 1 THEN 'item_opened'
            ELSE 'eligible'
       END AS reason
FROM x
ORDER BY item_id;


-- name: previous_conversations
-- Params: :customer_id (NULL = every customer), :before (received_at cutoff, NULL = no
-- cutoff). Pass the incoming message's received_at as :before so it is not counted itself.
-- unanswered = conversations with no agent_log row.
SELECT c.customer_id,
       c.name,
       COUNT(cv.conv_id) AS previous_conversations,
       COALESCE(SUM(CASE WHEN cv.conv_id IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM agent_log al WHERE al.conv_id = cv.conv_id)
                         THEN 1 ELSE 0 END), 0) AS unanswered,
       COALESCE(SUM(CASE WHEN cv.sentiment IN ('negative', 'angry') THEN 1 ELSE 0 END), 0) AS negative_or_angry
FROM customers c
LEFT JOIN conversations cv
       ON cv.customer_id = c.customer_id
      AND cv.received_at < COALESCE(:before, '9999-12-31 23:59:59')
WHERE :customer_id IS NULL OR c.customer_id = :customer_id
GROUP BY c.customer_id, c.name
ORDER BY c.customer_id;


-- name: does_sender_match_order_owner
-- Params: :order_id, :sender_handle (email, @instagram handle, or Viber phone number).
-- Always returns exactly one row; sender_matches_owner is 1 only if the handle equals
-- the owner's email / instagram_handle / phone (case-, '@'-, space-, '-'- and '+'-insensitive).
-- Unknown order, empty or unknown sender -> 0 (fails closed).
SELECT :order_id      AS order_id,
       :sender_handle AS sender_handle,
       COALESCE((
           SELECT 1
           FROM orders o
           JOIN customers c ON c.customer_id = o.customer_id
           WHERE o.order_id = :order_id
             AND (
                  lower(trim(:sender_handle)) = lower(c.email)
               OR NULLIF(ltrim(lower(trim(:sender_handle)), '@'), '')
                    = ltrim(lower(c.instagram_handle), '@')
               OR NULLIF(replace(replace(replace(trim(:sender_handle), ' ', ''), '-', ''), '+', ''), '')
                    = replace(replace(replace(c.phone, ' ', ''), '-', ''), '+', '')
             )
       ), 0) AS sender_matches_owner;
