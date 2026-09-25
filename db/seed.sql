-- seed.sql : sample data for shop.db
--
-- "Today" for every relative date below is 2026-09-24 (Thursday).
-- Shipment windows = order_date + 2..4 working days (Mon-Fri), i.e. the delivery policy.
-- All phone numbers / emails are synthetic (example.com).

PRAGMA foreign_keys = ON;
BEGIN;

-- ---------------------------------------------------------------------------
-- customers (8)
--   4 = Valmira (3rd contact), 5 = laptop shopper (no orders)
--   Arben's brother is deliberately NOT a customer.
-- ---------------------------------------------------------------------------
INSERT INTO customers (customer_id, name, phone, email, instagram_handle, language) VALUES
(1, 'Drita Krasniqi',  '+38344100101', 'drita.krasniqi@example.com',  NULL,               'sq'),
(2, 'Arben Hoxha',     '+38345100202', 'arben.hoxha@example.com',     '@arben.hoxha',     'sq'),
(3, 'Leotrim Berisha', '+38349100303', 'leotrim.berisha@example.com', NULL,               'en'),
(4, 'Valmira Gashi',   '+38343100404', 'valmira.gashi@example.com',   NULL,               'sq'),
(5, 'Ardit Morina',    NULL,           NULL,                          '@ardit.morina',    'en'),
(6, 'Fatmire Shala',   '+38349100606', 'fatmire.shala@example.com',   NULL,               'sq'),
(7, 'Besnik Rexhepi',  '+38345100707', 'besnik.rexhepi@example.com',  NULL,               'en'),
(8, 'Lirije Bytyqi',   '+38344100808', NULL,                          '@lirije.bytyqi',   'sq');

-- ---------------------------------------------------------------------------
-- products (10)
-- ---------------------------------------------------------------------------
INSERT INTO products (product_id, name, category, price, stock) VALUES
(1,  'Lenovo IdeaPad Slim 3 15"',     'laptop',     549.00,   4),
(2,  'HP Pavilion 15',                'laptop',     679.00,   0),
(3,  'ASUS Vivobook 16',              'laptop',     599.00,   7),
(4,  'Sony WH-CH720N',                'headphones', 129.00,  12),
(5,  'JBL Tune 520BT',                'headphones',  59.00,  25),
(6,  'Samsung Galaxy A55 5G',         'phone',      399.00,   6),
(7,  'Xiaomi Redmi Note 13',          'phone',      219.00,   9),
(8,  'Apple iPhone 15 128GB',         'phone',      749.00,   2),
(9,  'Anker 65W USB-C GaN Charger',   'charger',     39.90,  30),
(10, 'Samsung 25W USB-C Fast Charger','charger',     19.90,   0);

-- ---------------------------------------------------------------------------
-- orders (14)
-- ---------------------------------------------------------------------------
INSERT INTO orders (order_id, customer_id, order_date, status, ship_address, payment_method) VALUES
(1009, 8, '2026-07-14', 'delivered',  'Rr. Luan Haradinaj 6, Prishtine',  'cash_on_delivery'),
(1014, 3, '2026-08-05', 'delivered',  'Rr. Rexhep Luci 33, Prishtine',    'card'),             -- Leotrim: headphones
(1019, 6, '2026-08-13', 'delivered',  'Rr. Garibaldi 19, Prishtine',      'card'),
(1022, 7, '2026-08-20', 'delivered',  'Rr. Agim Ramadani 45, Prishtine',  'bank_transfer'),
(1026, 1, '2026-08-27', 'delivered',  'Rr. Fehmi Agani 8, Prishtine',     'cash_on_delivery'),
(1031, 2, '2026-09-03', 'delivered',  'Rr. Nena Tereze 12, Prishtine',    'card'),             -- Arben
(1034, 6, '2026-09-05', 'cancelled',  'Rr. Garibaldi 19, Prishtine',      'bank_transfer'),    -- no shipment
(1037, 8, '2026-09-08', 'delivered',  'Rr. Luan Haradinaj 6, Prishtine',  'cash_on_delivery'),
(1041, 4, '2026-09-10', 'delivered',  'Rr. Ukshin Hoti 27, Prishtine',    'card'),             -- Valmira: laptop
(1044, 3, '2026-09-14', 'delivered',  'Rr. Rexhep Luci 33, Prishtine',    'card'),
(1046, 7, '2026-09-15', 'delivered',  'Rr. Agim Ramadani 45, Prishtine',  'card'),
(1048, 1, '2026-09-16', 'shipped',    'Rr. Fehmi Agani 8, Prishtine',     'card'),             -- Drita: 8 days ago, LATE
(1049, 8, '2026-09-22', 'shipped',    'Rr. Luan Haradinaj 6, Prishtine',  'cash_on_delivery'), -- in transit, on time
(1050, 6, '2026-09-23', 'processing', 'Rr. Garibaldi 19, Prishtine',      'bank_transfer'),
(1052, 4, '2026-08-30', 'shipped',    'Rr. Ukshin Hoti 27, Prishtine',    'card'),
(1053, 2, '2026-09-09', 'shipped',    'Rr. Nena Tereze 12, Prishtine',    'card'),
(1054, 3, '2026-09-14', 'shipped',    'Rr. Rexhep Luci 33, Prishtine',    'card'),
(1055, 8, '2026-09-12', 'shipped',    'Rr. Luan Haradinaj 6, Prishtine',  'cash_on_delivery');    -- not shipped yet

-- ---------------------------------------------------------------------------
-- order_items (17)      opened_flag = 1 -> customer opened / used the item
-- ---------------------------------------------------------------------------
INSERT INTO order_items (item_id, order_id, product_id, qty, price, opened_flag) VALUES
(1,  1009,  7, 1, 219.00, 0),
(2,  1014,  4, 1, 129.00, 1),   -- Leotrim's Sony headphones: OPENED
(3,  1019,  5, 1,  59.00, 0),
(4,  1019,  9, 1,  39.90, 0),
(5,  1022,  3, 1, 599.00, 0),
(6,  1026, 10, 2,  19.90, 1),   -- one charger defective (see conversation 3)
(7,  1031,  8, 1, 749.00, 0),
(8,  1034,  2, 1, 679.00, 0),
(9,  1037,  6, 1, 399.00, 0),
(10, 1041,  1, 1, 549.00, 1),   -- Valmira's laptop (she says it will not power on)
(11, 1044,  9, 1,  39.90, 0),
(12, 1046,  5, 1,  59.00, 0),
(13, 1046, 10, 1,  19.90, 0),
(14, 1048,  6, 1, 399.00, 0),
(15, 1048, 10, 1,  19.90, 0),
(16, 1049,  9, 1,  39.90, 0),
(17, 1050,  2, 1, 679.00, 0),
(20, 1052,  8, 1, 749.00, 0),
(21, 1053,  3, 1, 599.00, 0),
(22, 1053,  5, 1,  59.00, 0),
(23, 1054,  7, 1, 219.00, 0),
(24, 1055,  6, 1, 399.00, 0);

-- ---------------------------------------------------------------------------
-- shipments (12) : every shipped/delivered order has one
-- ---------------------------------------------------------------------------
INSERT INTO shipments (shipment_id, order_id, carrier, shipped_date, expected_min_date, expected_max_date, tracking_status, last_update) VALUES
(1,  1009, 'Posta e Kosoves', '2026-07-15', '2026-07-16', '2026-07-20', 'delivered',  '2026-07-17 13:20:00'),
(2,  1014, 'DHL Express',     '2026-08-06', '2026-08-07', '2026-08-11', 'delivered',  '2026-08-10 11:45:00'),  -- delivered 45 days ago
(3,  1019, 'Kurier Prishtina','2026-08-14', '2026-08-17', '2026-08-19', 'delivered',  '2026-08-19 15:10:00'),  -- 36 days ago, unopened
(4,  1022, 'DHL Express',     '2026-08-21', '2026-08-24', '2026-08-26', 'delivered',  '2026-08-25 12:30:00'),  -- exactly 30 days ago
(5,  1026, 'Posta e Kosoves', '2026-08-28', '2026-08-31', '2026-09-02', 'delivered',  '2026-09-01 16:05:00'),
(6,  1031, 'DHL Express',     '2026-09-04', '2026-09-07', '2026-09-09', 'delivered',  '2026-09-08 10:40:00'),
(7,  1037, 'Kurier Prishtina','2026-09-09', '2026-09-10', '2026-09-14', 'delivered',  '2026-09-11 14:20:00'),
(8,  1041, 'DHL Express',     '2026-09-11', '2026-09-14', '2026-09-16', 'delivered',  '2026-09-15 11:15:00'),  -- "recently"
(9,  1044, 'Kurier Prishtina','2026-09-15', '2026-09-16', '2026-09-18', 'delivered',  '2026-09-18 13:00:00'),
(10, 1046, 'Posta e Kosoves', '2026-09-16', '2026-09-17', '2026-09-21', 'delivered',  '2026-09-21 12:10:00'),
(11, 1048, 'Posta e Kosoves', '2026-09-18', '2026-09-18', '2026-09-22', 'in_transit', '2026-09-21 09:12:00'),  -- shipped 6 days ago, expected_max passed -> LATE
(12, 1049, 'Kurier Prishtina','2026-09-23', '2026-09-24', '2026-09-28', 'in_transit', '2026-09-23 17:45:00'),
(13, 1052, 'DHL Express',     '2026-08-31', '2026-09-01', '2026-09-05', 'in_transit', '2026-09-02 08:30:00'),
(14, 1053, 'Posta e Kosoves', '2026-09-10', '2026-09-11', '2026-09-15', 'in_transit', '2026-09-12 10:05:00'),
(15, 1054, 'Kurier Prishtina','2026-09-15', '2026-09-16', '2026-09-20', 'in_transit', '2026-09-17 16:40:00'),
(16, 1055, 'Posta e Kosoves', '2026-09-13', '2026-09-14', '2026-09-15', 'in_transit', '2026-09-14 11:20:00');

-- ---------------------------------------------------------------------------
-- policies : exactly these four.
-- Installments, payment methods and delay compensation live in db/extensions.sql,
-- which is applied after this file (and once to databases created before it).
-- ---------------------------------------------------------------------------
INSERT INTO policies (policy_id, topic, rule_text, value) VALUES
(1, 'delivery', 'Delivery takes 2-4 working days.',                                                                  '2-4'),
(2, 'returns',  'Returns are accepted within 30 days from delivery, and the item must be unopened.',                 '30'),
(3, 'warranty', 'Defective items are handled by a human staff member.',                                              'human_staff'),
(4, 'privacy',  'Never share order or address details with anyone who is not the verified account owner.',          'verified_owner_only');

-- ---------------------------------------------------------------------------
-- conversations (9)
--   1-5 : already handled (see agent_log)
--   6,7 : Valmira, both angry, NO reply logged -> her next message is contact #3
--   8   : Arben's brother, unknown sender (customer_id NULL)
--   9   : Ardit asks about buying a laptop, no order involved
-- ---------------------------------------------------------------------------
INSERT INTO conversations (conv_id, customer_id, sender_handle, channel, message_text, language, received_at, sentiment) VALUES
(1, 6, 'fatmire.shala@example.com', 'email',
   'Përshëndetje, a mund të më tregoni ku ndodhet porosia ime #1019? Faleminderit paraprakisht.',
   'sq', '2026-08-17 09:14:00', 'neutral'),
(2, 7, '+38345100707', 'viber',
   'Hi! The ASUS laptop arrived yesterday. Very fast delivery, thank you!',
   'en', '2026-08-26 18:30:00', 'positive'),
(3, 1, '+38344100101', 'viber',
   'Përshëndetje, njëri nga dy ngarkuesit që bleva (porosia #1026) nuk punon fare. Çfarë duhet të bëj?',
   'sq', '2026-09-04 12:05:00', 'negative'),
(4, 8, '@lirije.bytyqi', 'instagram',
   'Përshëndetje! Sa ditë zgjat dërgesa në Prishtinë nëse porosis sot?',
   'sq', '2026-09-07 20:41:00', 'neutral'),
(5, 2, '@arben.hoxha', 'instagram',
   'Faleminderit, iPhone-i më mbërriti dje. Gjithçka në rregull!',
   'sq', '2026-09-09 08:52:00', 'positive'),
(6, 4, '+38343100404', 'viber',
   'Laptopi që e mora nuk ndizet fare! Ky është shërbim i tmerrshëm, dua përgjigje TANI.',
   'sq', '2026-09-18 10:12:00', 'angry'),
(7, 4, 'valmira.gashi@example.com', 'email',
   'Ju kam shkruar para tri ditësh dhe askush nuk m''u përgjigj. Laptopi është ende i prishur. Kjo është e papranueshme, dua zgjidhje sot!',
   'sq', '2026-09-21 09:03:00', 'angry'),
(8, NULL, '+38349100909', 'viber',
   'Përshëndetje, jam vëllai i Arbenit. A është dorëzuar porosia #1031 dhe në cilën adresë u dërgua?',
   'sq', '2026-09-23 19:20:00', 'neutral'),
(9, 5, '@ardit.morina', 'instagram',
   'Hello! I''m looking for a laptop for university, budget around 600 EUR. Which models do you have?',
   'en', '2026-09-24 09:47:00', 'neutral');

-- ---------------------------------------------------------------------------
-- agent_log (5) : decisions for conversations 1-5 only
-- ---------------------------------------------------------------------------
INSERT INTO agent_log (log_id, conv_id, intent, language, order_id, action, reason, reply_text, created_at) VALUES
(1, 1, 'order_status', 'sq', 1019, 'auto_reply',
   'Sender matches order owner; shipment in transit and within the expected window.',
   'Përshëndetje Fatmire, porosia #1019 është në transport dhe pritet të mbërrijë më së voni më 19 gusht. Faleminderit për durimin!',
   '2026-08-17 09:14:20'),
(2, 2, 'feedback', 'en', 1022, 'auto_reply',
   'Positive feedback from the order owner; nothing to resolve.',
   'Thank you for the kind words, Besnik! Enjoy your new laptop, and let us know if you need anything.',
   '2026-08-26 18:30:15'),
(3, 3, 'defective_item', 'sq', 1026, 'escalate',
   'Warranty policy: defective items are handled by a human staff member.',
   'Përshëndetje Drita, na vjen keq për problemin. Një anëtar i stafit tonë do t''ju kontaktojë së shpejti për ta zgjidhur çështjen.',
   '2026-09-04 12:05:18'),
(4, 4, 'delivery_time', 'sq', NULL, 'auto_reply',
   'General question answered from the delivery policy (2-4 working days); no order details involved.',
   'Përshëndetje! Dërgesa zgjat 2-4 ditë pune. Na shkruani nëse keni pyetje të tjera!',
   '2026-09-07 20:41:12'),
(5, 5, 'feedback', 'sq', 1031, 'auto_reply',
   'Positive feedback from the order owner; nothing to resolve.',
   'Faleminderit shumë, Arben! Gëzohemi që jeni i kënaqur. Na shkruani kurdo që keni nevojë!',
   '2026-09-09 08:52:10');

-- ---------------------------------------------------------------------------
-- escalations (1)
-- ---------------------------------------------------------------------------
INSERT INTO escalations (escalation_id, conv_id, priority, summary, status, created_at) VALUES
(1, 3, 'normal',
   'Drita Krasniqi (order #1026): one of two Samsung 25W chargers does not work. Warranty case - staff member must follow up.',
   'resolved', '2026-09-04 12:05:18');

COMMIT;
