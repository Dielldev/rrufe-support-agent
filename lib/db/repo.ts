import type { InStatement, Row } from "@libsql/client";
import { buildPolicyBook, type PolicyBook } from "@/lib/shop/policies";
import { OPS } from "@/lib/shop/operations";
import { addDays, isoDay, normEmail, normPhone, parseDay, parseTimestamp, sqlTimestamp } from "@/lib/engine/text";
import {
  CHANNELS,
  PRODUCT_CATEGORIES,
  type Channel,
  type Language,
  type ProductCategory,
  type Sender,
  type TriageResult,
  type VoucherKind,
} from "@/lib/engine/types";
import { db } from "./client";

/*
 * Every read and write the agent does against the shop database. Nothing else
 * in the app knows table or column names.
 */

// ---- record types -------------------------------------------------------------

export type OrderStatus = "pending" | "processing" | "shipped" | "delivered" | "cancelled" | "returned";
export type TrackingStatus = "in_transit" | "out_for_delivery" | "delivered" | "failed_delivery" | "returned_to_sender";

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  instagram?: string;
  language: Language;
}

export interface OrderItem {
  productId: string;
  name: string;
  category: ProductCategory;
  qty: number;
  price: number;
  /** order_items.opened_flag: the shop's record says the item was opened / used. */
  opened: boolean;
  imageUrl?: string;
}

export interface Shipment {
  carrier: string;
  shippedAt: Date;
  expectedMin: Date;
  expectedMax: Date;
  tracking: TrackingStatus;
  lastUpdate: Date;
}

export interface Order {
  id: string;
  customerId: string;
  buyer: { name: string; email?: string; phone?: string; instagram?: string; address: string };
  status: OrderStatus;
  paymentMethod: string;
  placedAt: Date;
  items: OrderItem[];
  shipment?: Shipment;
  /** date(last_update) of the shipment once tracking says delivered. */
  deliveredAt?: Date;
}

export interface ContactLogEntry {
  convId: number;
  receivedAt: Date;
  daysAgo: number;
  channel: Channel;
  summary: string;
  sentiment?: string;
  /** Answered = the agent log has a row for it (same definition as db/queries.sql). */
  answered: boolean;
}

// ---- helpers ------------------------------------------------------------------

const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
const num = (v: unknown) => Number(v);

async function query(stmt: InStatement): Promise<Row[]> {
  const client = await db();
  return (await client.execute(stmt)).rows;
}

function customerFrom(r: Row): Customer {
  return {
    id: String(r.customer_id),
    name: String(r.name),
    phone: str(r.phone),
    email: str(r.email),
    instagram: str(r.instagram_handle),
    language: r.language === "en" ? "en" : "sq",
  };
}

const SQL_PHONE = (col: string) => `replace(replace(replace(${col}, ' ', ''), '-', ''), '+', '')`;
const handleKey = (h: string) => h.trim().toLowerCase().replace(/^@/, "");

// ---- policies -----------------------------------------------------------------

export async function getPolicyBook(): Promise<PolicyBook> {
  const rows = await query("SELECT topic, rule_text, value FROM policies ORDER BY policy_id");
  return buildPolicyBook(rows.map((r) => ({ topic: String(r.topic), text: String(r.rule_text), value: str(r.value) ?? null })));
}

// ---- customers & senders ------------------------------------------------------

export async function listCustomers(): Promise<Customer[]> {
  return (await query("SELECT * FROM customers ORDER BY customer_id")).map(customerFrom);
}

export async function findCustomer(id: string): Promise<Customer | undefined> {
  if (!/^\d{1,9}$/.test(id)) return undefined;
  const [row] = await query({ sql: "SELECT * FROM customers WHERE customer_id = ?", args: [Number(id)] });
  return row ? customerFrom(row) : undefined;
}

export interface CustomerPersonaOrder {
  id: string;
  items: string;
  status: OrderStatus;
  stage?: "late" | "on_the_way" | "preparing" | "delivered" | "closed" | "courier_problem";
  daysLate?: number;
}

export interface CustomerPersona extends Customer {
  orderCount: number;
  orders: CustomerPersonaOrder[];
}

/** Customers with order counts and order summaries from the database for the user picker. */
export async function customerPersonas(): Promise<CustomerPersona[]> {
  const [customers, orders] = await Promise.all([listCustomers(), listOrders()]);
  return customers.map((c) => {
    const custOrders = orders.filter((o) => o.customerId === c.id);
    return {
      ...c,
      orderCount: custOrders.length,
      orders: custOrders.map((o) => ({
        id: o.id,
        items: o.items.map((i) => i.name).join(", "),
        status: o.status,
      })),
    };
  });
}

/** The customer an inbox handle belongs to (email, Viber phone or Instagram handle). */
export async function customerByHandle(channel: Channel, handle: string): Promise<Customer | undefined> {
  const h = handle.trim();
  if (!h) return undefined;
  const sql =
    channel === "email"
      ? { sql: "SELECT * FROM customers WHERE lower(email) = lower(?)", args: [h] }
      : channel === "instagram"
        ? { sql: "SELECT * FROM customers WHERE ltrim(lower(instagram_handle), '@') = ?", args: [handleKey(h)] }
        : { sql: `SELECT * FROM customers WHERE ${SQL_PHONE("phone")} = ?`, args: [h.replace(/[\s+-]/g, "")] };
  const [row] = await query(sql);
  return row ? customerFrom(row) : undefined;
}

export function senderId(channel: Channel, handle: string): string {
  return `${channel}:${handle}`;
}

function parseSenderId(id: string): { channel: Channel; handle: string } | undefined {
  const sep = id.indexOf(":");
  if (sep <= 0) return undefined;
  const channel = id.slice(0, sep) as Channel;
  const handle = id.slice(sep + 1).trim();
  if (!CHANNELS.includes(channel) || !handle || handle.length > 120) return undefined;
  const ok =
    channel === "email"
      ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(handle)
      : channel === "viber"
        ? /^\+?[\d\s-]{6,20}$/.test(handle)
        : /^@?[\w.]{1,60}$/.test(handle);
  return ok ? { channel, handle } : undefined;
}

function toSender(channel: Channel, handle: string, customer?: Customer): Sender {
  return {
    id: senderId(channel, handle),
    customerId: customer?.id,
    channel,
    handle,
    displayName: customer?.name ?? (channel === "instagram" && handle === GUEST_HANDLE ? "New contact" : handle),
    email: channel === "email" ? handle : undefined,
    phone: channel === "viber" ? handle : undefined,
  };
}

/** A fresh Instagram account that isn't in the customer table. */
export const GUEST_HANDLE = "@new.customer";

/**
 * Resolve an inbox identity. The channel verifies the handle (the From: address,
 * the Viber number, the Instagram account); the database decides whether it
 * belongs to a customer. Unknown handles are valid senders with no customer link.
 */
export async function resolveSender(id: string): Promise<Sender | undefined> {
  const parsed = parseSenderId(id);
  if (!parsed) return undefined;
  return toSender(parsed.channel, parsed.handle, await customerByHandle(parsed.channel, parsed.handle));
}

/** Every identity the demo inbox can write from: each customer channel, earlier unknown senders, and a new contact. */
export async function listSenders(): Promise<Sender[]> {
  const customers = await listCustomers();
  const senders: Sender[] = [];
  for (const c of customers) {
    if (c.phone) senders.push(toSender("viber", c.phone, c));
    if (c.email) senders.push(toSender("email", c.email, c));
    if (c.instagram) senders.push(toSender("instagram", c.instagram, c));
  }
  const unknown = await query(
    "SELECT DISTINCT channel, sender_handle FROM conversations WHERE customer_id IS NULL ORDER BY received_at LIMIT 20",
  );
  for (const r of unknown) {
    const s = toSender(r.channel as Channel, String(r.sender_handle));
    if (!senders.some((x) => x.id === s.id)) senders.push(s);
  }
  senders.push(toSender("instagram", GUEST_HANDLE));
  return senders;
}

// ---- orders -------------------------------------------------------------------

const ORDER_SELECT = `
  SELECT o.order_id, o.customer_id, o.order_date, o.status, o.ship_address, o.payment_method,
         c.name, c.email, c.phone, c.instagram_handle,
         s.carrier, s.shipped_date, s.expected_min_date, s.expected_max_date, s.tracking_status, s.last_update
    FROM orders o
    JOIN customers c ON c.customer_id = o.customer_id
    LEFT JOIN shipments s ON s.shipment_id = (
      SELECT MAX(shipment_id) FROM shipments WHERE order_id = o.order_id
    )`;

async function loadOrders(where: string, args: (string | number)[]): Promise<Order[]> {
  const rows = await query({ sql: `${ORDER_SELECT} ${where}`, args });
  if (!rows.length) return [];
  const ids = rows.map((r) => num(r.order_id));
  const items = await query({
    sql: `SELECT oi.order_id, oi.product_id, oi.qty, oi.price, oi.opened_flag, p.name, p.category, p.image_url
            FROM order_items oi JOIN products p ON p.product_id = oi.product_id
           WHERE oi.order_id IN (${ids.map(() => "?").join(",")})
           ORDER BY oi.item_id`,
    args: ids,
  });
  return rows.map((r) => {
    const shipment: Shipment | undefined = r.carrier
      ? {
          carrier: String(r.carrier),
          shippedAt: parseDay(String(r.shipped_date)),
          expectedMin: parseDay(String(r.expected_min_date)),
          expectedMax: parseDay(String(r.expected_max_date)),
          tracking: String(r.tracking_status) as TrackingStatus,
          lastUpdate: parseTimestamp(String(r.last_update)),
        }
      : undefined;
    const delivered = shipment?.tracking === "delivered";
    return {
      id: String(r.order_id),
      customerId: String(r.customer_id),
      buyer: {
        name: String(r.name),
        email: str(r.email),
        phone: str(r.phone),
        instagram: str(r.instagram_handle),
        address: String(r.ship_address),
      },
      status: String(r.status) as OrderStatus,
      paymentMethod: String(r.payment_method),
      placedAt: parseDay(String(r.order_date)),
      items: items
        .filter((i) => num(i.order_id) === num(r.order_id))
        .map((i) => ({
          productId: String(i.product_id),
          name: String(i.name),
          category: (PRODUCT_CATEGORIES as readonly string[]).includes(String(i.category))
            ? (String(i.category) as ProductCategory)
            : "laptop",
          qty: num(i.qty),
          price: num(i.price),
          opened: num(i.opened_flag) === 1,
          imageUrl: str(i.image_url),
        })),
      shipment,
      deliveredAt: delivered ? parseDay(String(r.last_update)) : undefined,
    };
  });
}

export async function findOrder(id: string): Promise<Order | undefined> {
  if (!/^\d{1,9}$/.test(id)) return undefined;
  return (await loadOrders("WHERE o.order_id = ?", [Number(id)]))[0];
}

export async function ordersOfCustomer(customerId: string): Promise<Order[]> {
  return loadOrders("WHERE o.customer_id = ? ORDER BY o.order_date DESC, o.order_id DESC", [Number(customerId)]);
}

export type OrderChangeKind = "address" | "remove_item" | "cancel";

export interface OrderChangeContext {
  order: Order;
  via: string;
  now: Date;
  statuses: string[];
}

function inList(values: string[]): string {
  return values.map(() => "?").join(", ");
}

function auditChange(ctx: OrderChangeContext, kind: OrderChangeKind, before: string, after: string): InStatement {
  return {
    sql: `INSERT INTO order_changes (order_id, customer_id, kind, before_value, after_value, requested_via, changed_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
    args: [Number(ctx.order.id), Number(ctx.order.customerId), kind, before, after, ctx.via, sqlTimestamp(ctx.now)],
  };
}

export async function lastOrderChange(orderId: string): Promise<{ kind: string; after: string; via: string } | undefined> {
  const [row] = await query({ sql: "SELECT kind, after_value, requested_via FROM order_changes WHERE order_id = ? ORDER BY change_id DESC LIMIT 1", args: [Number(orderId)] });
  return row ? { kind: String(row.kind), after: String(row.after_value ?? ""), via: String(row.requested_via) } : undefined;
}

export async function countOrderChanges(orderId: string, kind: OrderChangeKind): Promise<number> {
  const [row] = await query({ sql: "SELECT COUNT(*) AS n FROM order_changes WHERE order_id = ? AND kind = ?", args: [Number(orderId), kind] });
  return num(row?.n);
}

export async function changeShipAddress(ctx: OrderChangeContext, address: string): Promise<boolean> {
  if (!ctx.statuses.length) return false;
  const client = await db();
  const [updated] = await client.batch(
    [
      {
        sql: `UPDATE orders SET ship_address = ?
               WHERE order_id = ? AND customer_id = ? AND status IN (${inList(ctx.statuses)}) AND ship_address <> ?`,
        args: [address, Number(ctx.order.id), Number(ctx.order.customerId), ...ctx.statuses, address],
      },
      auditChange(ctx, "address", ctx.order.buyer.address, address),
    ],
    "write",
  );
  return updated.rowsAffected === 1;
}

export async function removeOrderItem(ctx: OrderChangeContext & { payments: string[] }, item: OrderItem, qty: number): Promise<boolean> {
  if (!ctx.statuses.length || !ctx.payments.length || qty < 1 || qty > item.qty) return false;
  const guard = `EXISTS (SELECT 1 FROM orders WHERE order_id = ? AND customer_id = ? AND status IN (${inList(ctx.statuses)}) AND payment_method IN (${inList(ctx.payments)}))`;
  const guardArgs = [Number(ctx.order.id), Number(ctx.order.customerId), ...ctx.statuses, ...ctx.payments];
  const whole = qty === item.qty;
  const change: InStatement = whole
    ? {
        sql: `DELETE FROM order_items
               WHERE order_id = ? AND product_id = ? AND qty = ?
                 AND (SELECT COUNT(*) FROM order_items WHERE order_id = ?) > 1 AND ${guard}`,
        args: [Number(ctx.order.id), Number(item.productId), item.qty, Number(ctx.order.id), ...guardArgs],
      }
    : {
        sql: `UPDATE order_items SET qty = qty - ? WHERE order_id = ? AND product_id = ? AND qty = ? AND ${guard}`,
        args: [qty, Number(ctx.order.id), Number(item.productId), item.qty, ...guardArgs],
      };
  const client = await db();
  const [changed] = await client.batch(
    [
      change,
      auditChange(ctx, "remove_item", `${item.qty}× ${item.name}`, whole ? `removed ${item.name}` : `${item.qty - qty}× ${item.name}`),
      { sql: "UPDATE products SET stock = stock + ? WHERE product_id = ? AND stock IS NOT NULL AND changes() = 1", args: [qty, Number(item.productId)] },
    ],
    "write",
  );
  return changed.rowsAffected === 1;
}

export async function cancelOrder(ctx: OrderChangeContext & { payments: string[] }): Promise<boolean> {
  if (!ctx.statuses.length || !ctx.payments.length) return false;
  const id = Number(ctx.order.id);
  const client = await db();
  const [cancelled] = await client.batch(
    [
      {
        sql: `UPDATE orders SET status = 'cancelled'
               WHERE order_id = ? AND customer_id = ? AND status IN (${inList(ctx.statuses)}) AND payment_method IN (${inList(ctx.payments)})`,
        args: [id, Number(ctx.order.customerId), ...ctx.statuses, ...ctx.payments],
      },
      auditChange(ctx, "cancel", ctx.order.status, "cancelled"),
      {
        sql: `UPDATE products SET stock = stock + (SELECT qty FROM order_items WHERE order_id = ? AND product_id = products.product_id)
               WHERE stock IS NOT NULL AND product_id IN (SELECT product_id FROM order_items WHERE order_id = ?) AND changes() = 1`,
        args: [id, id],
      },
    ],
    "write",
  );
  return cancelled.rowsAffected === 1;
}

export async function listOrders(): Promise<Order[]> {
  return loadOrders("ORDER BY o.order_date DESC, o.order_id DESC", []);
}

/** Whether an inbox handle is one of the order owner's contacts (mirrors does_sender_match_order_owner). */
export function handleMatchesBuyer(order: Order, sender: Sender): boolean {
  if (sender.customerId && sender.customerId === order.customerId) return true;
  if (sender.email && order.buyer.email && normEmail(sender.email) === normEmail(order.buyer.email)) return true;
  if (sender.phone && order.buyer.phone && normPhone(sender.phone) === normPhone(order.buyer.phone)) return true;
  if (sender.channel === "instagram" && order.buyer.instagram) return handleKey(sender.handle) === handleKey(order.buyer.instagram);
  return false;
}

// ---- products -------------------------------------------------------------------

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  price: number;
  /** Units on hand; undefined when the shop doesn't track stock for it. */
  stock?: number;
}

export interface ProductQuery {
  /** Free text: words are matched against the product name and category. */
  text?: string;
  category?: ProductCategory;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  limit?: number;
}

/** Words that map to a category, in English and Albanian. */
const CATEGORY_WORDS: [RegExp, ProductCategory][] = [
  [/^(laptops?|notebooks?|kompjuter\w*|laptop\w*)$/, "laptop"],
  [/^(headphones?|earbuds?|headsets?|kufje\w*)$/, "headphones"],
  [/^(phones?|smartphones?|mobiles?|telefon\w*|celular\w*)$/, "phone"],
  [/^(chargers?|adapters?|karikues\w*|ngarkues\w*)$/, "charger"],
];
const STOP_WORDS = new Set([
  "a", "an", "the", "any", "some", "do", "you", "have", "has", "for", "with", "and", "or", "me", "i", "is", "are",
  "there", "in", "stock", "available", "under", "below", "over", "cheap", "cheapest", "price", "prices", "how", "much",
  "what", "which", "new", "best", "e", "te", "të", "një", "nje", "keni", "ka", "në", "ne", "stok", "nën", "nen", "sa",
  "kushton", "çmimi", "cmimi", "më", "me", "lirë", "lire", "ndonjë", "ndonje",
]);

function productFrom(r: Row): Product {
  const category = String(r.category);
  return {
    id: String(r.product_id),
    name: String(r.name),
    category: (PRODUCT_CATEGORIES as readonly string[]).includes(category) ? (category as ProductCategory) : "laptop",
    price: num(r.price),
    stock: r.stock === null || r.stock === undefined ? undefined : num(r.stock),
  };
}

/**
 * Catalog search. The catalog is public shop data, so any sender may use it.
 * Every word must match the name or category; if nothing matches, any word may.
 */
export async function searchProducts(q: ProductQuery = {}): Promise<Product[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  let category = q.category;
  const words: string[] = [];
  for (const raw of (q.text ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || STOP_WORDS.has(raw) || /^\d+$/.test(raw) || raw.length > 40) continue;
    const cat = CATEGORY_WORDS.find(([re]) => re.test(raw))?.[1];
    if (cat && !category) category = cat;
    else if (!cat) words.push(raw);
  }
  if (category) {
    where.push("category = ?");
    args.push(category);
  }
  if (q.minPrice !== undefined && Number.isFinite(q.minPrice)) {
    where.push("price >= ?");
    args.push(q.minPrice);
  }
  if (q.maxPrice !== undefined && Number.isFinite(q.maxPrice)) {
    where.push("price <= ?");
    args.push(q.maxPrice);
  }
  if (q.inStockOnly) where.push("(stock IS NULL OR stock > 0)");
  const limit = Math.min(Math.max(q.limit ?? 8, 1), 20);

  const run = async (join: "AND" | "OR") => {
    const w = [...where];
    const a = [...args];
    if (words.length) {
      w.push(`(${words.map(() => "lower(name) LIKE ?").join(` ${join} `)})`);
      a.push(...words.slice(0, 6).map((t) => `%${t.replace(/[%_]/g, "")}%`));
    }
    const rows = await query({
      sql: `SELECT product_id, name, category, price, stock FROM products ${w.length ? `WHERE ${w.join(" AND ")}` : ""} ORDER BY price LIMIT ?`,
      args: [...a, limit],
    });
    return rows.map(productFrom);
  };
  words.splice(6);
  const strict = await run("AND");
  return strict.length || words.length < 2 ? strict : run("OR");
}

// ---- vouchers -----------------------------------------------------------------------

export interface Voucher {
  code: string;
  orderId: string;
  customerId: string;
  kind: VoucherKind;
  percent?: number;
  amountEur?: number;
  issuedAt: Date;
  expiresOn: Date;
  redeemed: boolean;
}

function voucherFrom(r: Row): Voucher {
  return {
    code: String(r.code),
    orderId: String(r.order_id),
    customerId: String(r.customer_id),
    kind: (["percent", "free_shipping", "gift_card"] as const).find((k) => k === r.kind) ?? "percent",
    percent: r.percent === null || r.percent === undefined ? undefined : num(r.percent),
    amountEur: r.amount_eur === null || r.amount_eur === undefined ? undefined : num(r.amount_eur),
    issuedAt: parseTimestamp(String(r.issued_at)),
    expiresOn: parseDay(String(r.expires_on)),
    redeemed: r.redeemed_at !== null && r.redeemed_at !== undefined,
  };
}

export async function vouchersForOrders(orderIds: string[]): Promise<Map<string, Voucher>> {
  const ids = orderIds.filter((id) => /^\d{1,9}$/.test(id)).map(Number);
  if (!ids.length) return new Map();
  const rows = await query({ sql: `SELECT * FROM vouchers WHERE order_id IN (${ids.map(() => "?").join(", ")})`, args: ids });
  return new Map(rows.map((r) => [String(r.order_id), voucherFrom(r)]));
}

export async function voucherForOrder(orderId: string): Promise<Voucher | undefined> {
  if (!/^\d{1,9}$/.test(orderId)) return undefined;
  const [row] = await query({ sql: "SELECT * FROM vouchers WHERE order_id = ?", args: [Number(orderId)] });
  return row ? voucherFrom(row) : undefined;
}

/** Unguessable code: no 0/O/1/I so it can be read out over the phone. */
export type DelayReward = { kind: "percent"; percent: number } | { kind: "free_shipping" } | { kind: "gift_card"; amountEur: number };

function voucherCode(reward: DelayReward): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const body = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  const tag = reward.kind === "percent" ? `${reward.percent}` : reward.kind === "gift_card" ? `GC${reward.amountEur}` : "SHIP";
  return `RRUFE${tag}-${body.slice(0, 4)}-${body.slice(4)}`;
}

/**
 * Issue the delay voucher for an order, or return the one it already has.
 * One per order is enforced by the UNIQUE key on vouchers.order_id, so two
 * concurrent requests still produce a single voucher.
 */
export async function issueDelayVoucher(input: {
  order: Order;
  reward: DelayReward;
  validDays: number;
  now: Date;
  today: Date;
}): Promise<{ voucher: Voucher; alreadyIssued: boolean }> {
  const existing = await voucherForOrder(input.order.id);
  if (existing) return { voucher: existing, alreadyIssued: true };
  const client = await db();
  const inserted = await client.execute({
    sql: `INSERT INTO vouchers (code, customer_id, order_id, reason, kind, percent, amount_eur, issued_at, expires_on)
          VALUES (?, ?, ?, 'delivery_delay', ?, ?, ?, ?, ?)
          ON CONFLICT (order_id) DO NOTHING`,
    args: [
      voucherCode(input.reward),
      Number(input.order.customerId),
      Number(input.order.id),
      input.reward.kind,
      input.reward.kind === "percent" ? input.reward.percent : null,
      input.reward.kind === "gift_card" ? input.reward.amountEur : null,
      sqlTimestamp(input.now),
      isoDay(addDays(input.today, input.validDays)),
    ],
  });
  const voucher = await voucherForOrder(input.order.id);
  if (!voucher) throw new Error(`voucher for order ${input.order.id} was not stored`);
  // rowsAffected 0 = another request issued it first; that one stands.
  return { voucher, alreadyIssued: inserted.rowsAffected === 0 };
}

// ---- personal data guard ----------------------------------------------------------

/**
 * Every contact detail and address the shop holds. The agent's reply validator
 * blocks any of these that the tools didn't hand to this requester.
 */
export async function protectedPersonalData(): Promise<string[]> {
  const rows = await query(
    `SELECT email AS v FROM customers WHERE email IS NOT NULL
     UNION SELECT phone FROM customers WHERE phone IS NOT NULL
     UNION SELECT ship_address FROM orders`,
  );
  return rows.map((r) => String(r.v)).filter(Boolean);
}

// ---- conversations --------------------------------------------------------------

function contactFrom(r: Row, today: Date): ContactLogEntry {
  const receivedAt = parseTimestamp(String(r.received_at));
  return {
    convId: num(r.conv_id),
    receivedAt,
    daysAgo: Math.max(0, Math.floor((today.getTime() - parseDay(String(r.received_at)).getTime()) / 86_400_000)),
    channel: r.channel as Channel,
    summary: String(r.message_text),
    sentiment: str(r.sentiment),
    answered: num(r.answered) === 1,
  };
}

const CONTACT_SELECT = `
  SELECT cv.conv_id, cv.channel, cv.message_text, cv.received_at, cv.sentiment,
         EXISTS (SELECT 1 FROM agent_log al WHERE al.conv_id = cv.conv_id) AS answered
    FROM conversations cv`;

/**
 * Earlier messages from this person within the repeat-contact window: every
 * channel of a known customer, or the same handle for an unknown sender.
 */
export async function contactLog(sender: Sender, now: Date, today: Date): Promise<ContactLogEntry[]> {
  const since = sqlTimestamp(addDays(today, -OPS.repeatWindowDays));
  const before = sqlTimestamp(now);
  const who = sender.customerId ? "cv.customer_id = ?" : "cv.customer_id IS NULL AND cv.channel = ? AND lower(cv.sender_handle) = lower(?)";
  const whoArgs = sender.customerId ? [Number(sender.customerId)] : [sender.channel, sender.handle];
  const rows = await query({
    sql: `${CONTACT_SELECT} WHERE ${who} AND cv.received_at >= ? AND cv.received_at < ? ORDER BY cv.received_at`,
    args: [...whoArgs, since, before],
  });
  return rows.map((r) => contactFrom(r, today));
}

export interface ConversationView extends ContactLogEntry {
  customer?: string;
  handle: string;
  action?: string;
  escalation?: string;
}

/** Recent inbox history for the Orders page, optionally isolated to one customer. */
export async function listConversations(today: Date, limit = 50, customerId?: string): Promise<ConversationView[]> {
  const where = customerId && /^\d+$/.test(customerId) ? "WHERE cv.customer_id = ?" : "";
  const args = customerId && /^\d+$/.test(customerId) ? [Number(customerId), limit] : [limit];
  const rows = await query({
    sql: `SELECT cv.conv_id, cv.channel, cv.message_text, cv.received_at, cv.sentiment, cv.sender_handle, c.name,
                 (SELECT action FROM agent_log al WHERE al.conv_id = cv.conv_id ORDER BY log_id DESC LIMIT 1) AS action,
                 (SELECT status FROM escalations e WHERE e.conv_id = cv.conv_id ORDER BY escalation_id DESC LIMIT 1) AS escalation,
                 EXISTS (SELECT 1 FROM agent_log al WHERE al.conv_id = cv.conv_id) AS answered
            FROM conversations cv LEFT JOIN customers c ON c.customer_id = cv.customer_id
           ${where}
           ORDER BY cv.received_at DESC LIMIT ?`,
    args,
  });
  return rows.map((r) => ({
    ...contactFrom(r, today),
    customer: str(r.name),
    handle: String(r.sender_handle),
    action: str(r.action),
    escalation: str(r.escalation),
  }));
}

// ---- audit trail ----------------------------------------------------------------

/**
 * Write the message and the agent's decision: one conversations row, one
 * agent_log row, and an escalations row when a person has to take over.
 * Runs as a single transaction.
 */
export async function recordTriage(input: { sender: Sender; text: string; result: TriageResult; now: Date }): Promise<number> {
  const { sender, text, result, now } = input;
  const client = await db();
  const receivedAt = sqlTimestamp(now);
  const frustrated = result.why.signals.some((c) => c.label === "Frustration");
  const tx = await client.transaction("write");
  try {
    const conv = await tx.execute({
      sql: `INSERT INTO conversations (customer_id, sender_handle, channel, message_text, language, received_at, sentiment)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        sender.customerId ? Number(sender.customerId) : null,
        sender.handle,
        sender.channel,
        text,
        result.reply.language,
        receivedAt,
        frustrated ? "angry" : "neutral",
      ],
    });
    const convId = Number(conv.lastInsertRowid);
    await tx.execute({
      sql: `INSERT INTO agent_log (conv_id, intent, language, order_id, action, reason, reply_text, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        convId,
        result.intent,
        result.reply.language,
        result.orderId ? Number(result.orderId) : null,
        result.decision === "escalate" ? "escalate" : "auto_reply",
        `${result.why.firedRule.id} · ${result.outcome}: ${result.why.summary}`.slice(0, 2000),
        result.reply.text,
        receivedAt,
      ],
    });
    if (result.decision === "escalate") {
      await tx.execute({
        sql: "INSERT INTO escalations (conv_id, priority, summary, status, created_at) VALUES (?, ?, ?, 'open', ?)",
        args: [
          convId,
          result.why.handoff?.priority === "urgent" ? "high" : "normal",
          (result.why.handoff?.note ?? result.why.summary).slice(0, 2000),
          receivedAt,
        ],
      });
    }
    await tx.commit();
    return convId;
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

// ---- status -----------------------------------------------------------------------

export async function tableCounts(): Promise<Record<string, number>> {
  const tables = ["customers", "products", "orders", "order_items", "shipments", "policies", "conversations", "agent_log", "escalations", "vouchers", "order_changes", "chat_sessions", "chat_messages"];
  const rows = await query(`SELECT ${tables.map((t) => `(SELECT COUNT(*) FROM ${t}) AS ${t}`).join(", ")}`);
  return Object.fromEntries(tables.map((t) => [t, num(rows[0][t])]));
}
