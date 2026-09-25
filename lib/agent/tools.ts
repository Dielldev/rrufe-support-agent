import { tool } from "ai";
import { z } from "zod";
import {
  cancelOrder,
  changeShipAddress,
  countOrderChanges,
  findCustomer,
  findOrder,
  issueDelayVoucher,
  lastOrderChange,
  ordersOfCustomer,
  removeOrderItem,
  searchProducts,
  voucherForOrder,
  vouchersForOrders,
  type Order,
  type OrderItem,
} from "@/lib/db/repo";
import { detectOrderChange, productCategoriesIn } from "@/lib/engine/signals";
import { isoDay } from "@/lib/engine/text";
import { PRODUCT_CATEGORIES, type OrderChangeKind, type ToolAccess } from "@/lib/engine/types";
import { OPS } from "@/lib/shop/operations";
import { orderAccess, type AccessGrant } from "./access";
import type { ToolLedger } from "./ledger";
import { accountView, changeOptions, compensationGiven, delayReward, deliveryView, orderDetail, orderSummary, productView, rewardLabel } from "./views";

/*
 * The agent's tools. They are built per request around an AccessGrant, so the
 * requester's identity is baked in by code:
 *
 *   - No tool takes a customer id, email or phone. "Show me customer 2's orders"
 *     has no tool to go to; extra arguments a model invents are stripped by zod.
 *   - Order tools re-check ownership on every call (same check as rule R3).
 *     A refusal looks the same whether the order is someone else's or doesn't
 *     exist, so order numbers can't be probed.
 *   - Actions (carrier trace, handoff) check their own preconditions in code.
 */

const ORDER_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled", "returned"] as const;

const orderIdSchema = z
  .string()
  .max(20)
  .describe('The order number, digits only, e.g. "1048".');

/** "#1048", "order 1048", 1048 → "1048". Anything else → undefined. */
function cleanOrderId(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");
  return /^\d{1,9}$/.test(digits) ? digits : undefined;
}

const HOW_TO_VERIFY =
  "Only the buyer can see an order. Ask them to write from the phone number or email used on the order, or to send BOTH the email and the phone number on the order in one message. Do not say whether the order exists.";

const OTHER_ACCOUNT =
  "You can only help with orders placed from this account. Don't say whether this order exists or whose it is, and don't suggest any way to open it: if someone else placed it, that person has to ask from their own account.";

function denial(orderId: string, reason: "third_party" | "not_owner", linked: boolean) {
  return {
    access: "denied" as const,
    order_id: orderId,
    reason:
      reason === "third_party"
        ? "The writer said they are acting for someone else. Order details only go to the buyer themself."
        : linked
          ? "This order isn't on the writer's account, or doesn't exist."
          : "This order number isn't linked to the person writing, or doesn't exist.",
    what_to_tell_the_customer: linked || reason === "third_party" ? OTHER_ACCOUNT : HOW_TO_VERIFY,
  };
}

const NO_ACCOUNT = {
  access: "denied" as const,
  reason: "No customer account is linked to this conversation (the sender is unknown, or said they're writing for someone else).",
  what_to_tell_the_customer:
    "To look up an order, they can write from the phone number or email they ordered with, or send the order number together with BOTH the email and phone number on it.",
};

const MAX_CHANGES_PER_REPLY = 3;
const CHANGE_TOOLS = ["change_delivery_address", "remove_order_item", "cancel_order"];

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function words(text: string): string[] {
  return fold(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

function cleanAddress(raw: string): string | undefined {
  const address = raw.replace(/\s+/g, " ").trim();
  if (address.length < 8 || address.length > 120) return undefined;
  if (/[<>{}[\]@\\|]|https?:|www\./i.test(address)) return undefined;
  if (!/\p{L}{2}/u.test(address) || words(address).length < 2) return undefined;
  return address;
}

function writtenByCustomer(value: string, customerTexts: string[]): boolean {
  const said = new Set(customerTexts.flatMap(words));
  const wanted = words(value);
  return wanted.length > 0 && wanted.every((w) => said.has(w));
}

function findItem(order: Order, name: string): OrderItem | OrderItem[] {
  const want = fold(name).trim();
  const exact = order.items.filter((i) => fold(i.name) === want);
  if (exact.length === 1) return exact[0];
  const loose = order.items.filter((i) => fold(i.name).includes(want) || want.includes(fold(i.name)));
  return loose.length === 1 ? loose[0] : loose.length ? loose : order.items;
}

function mentionedByCustomer(item: OrderItem, order: Order, customerTexts: string[]): boolean {
  const categories = customerTexts.flatMap(productCategoriesIn);
  const sameCategory = order.items.filter((i) => i.category === item.category).length;
  if (categories.includes(item.category) && sameCategory === 1) return true;
  const others = new Set(order.items.filter((i) => i !== item).flatMap((i) => words(i.name)));
  const said = new Set(customerTexts.flatMap(words));
  return words(item.name).some((w) => w.length >= 4 && !/^\d/.test(w) && !others.has(w) && said.has(w));
}

type ToolOutput = Record<string, unknown>;
interface ToolRun {
  output: ToolOutput;
  access: ToolAccess;
  summary: string;
}

/** What the customer sees in the chat while a tool runs. Never includes anything the tool returns. */
function progressLabel(name: string, input: Record<string, unknown>): string {
  const id = typeof input.order_id === "string" ? cleanOrderId(input.order_id) : undefined;
  switch (name) {
    case "get_my_account":
      return "Opening your account";
    case "list_my_orders":
      return "Looking up your orders";
    case "get_order":
      return id ? `Checking order #${id}` : "Checking the order";
    case "search_products":
      return typeof input.query === "string" && input.query ? `Searching the catalog for “${input.query.slice(0, 40)}”` : "Searching the catalog";
    case "open_carrier_trace":
      return id ? `Asking the courier to trace #${id}` : "Asking the courier";
    case "issue_delay_voucher":
      return "Preparing your delay voucher";
    case "change_delivery_address":
      return id ? `Updating the address on #${id}` : "Updating the address";
    case "remove_order_item":
      return id ? `Updating order #${id}` : "Updating the order";
    case "cancel_order":
      return id ? `Cancelling order #${id}` : "Cancelling the order";
    case "request_human":
      return "Bringing in a colleague";
    default:
      return "Working on it";
  }
}

let stepSeq = 0;

export function createSupportTools(grant: AccessGrant, ledger: ToolLedger, customerTexts: string[] = []) {
  async function traced(name: string, input: Record<string, unknown>, fn: () => Promise<ToolRun>): Promise<ToolOutput> {
    const started = performance.now();
    const stepId = `tool-${++stepSeq}`;
    const label = progressLabel(name, input);
    ledger.onEvent?.({ type: "step", id: stepId, label, status: "active" });
    try {
      const { output, access, summary } = await fn();
      ledger.record({ tool: name, input, access, summary, latencyMs: Math.round(performance.now() - started) }, output);
      ledger.onEvent?.({ type: "step", id: stepId, label, status: access === "denied" || access === "refused" ? "blocked" : "done" });
      return output;
    } catch (err) {
      console.error(`[agent] tool ${name} failed`, err);
      const output = { error: "The lookup failed. Tell the customer you'll pass the question to a colleague, and call request_human." };
      ledger.record({ tool: name, input, access: "error", summary: "Lookup failed", latencyMs: Math.round(performance.now() - started) }, output);
      ledger.onEvent?.({ type: "step", id: stepId, label, status: "failed" });
      return output;
    }
  }

  const today = grant.today;
  const policies = grant.policies;
  const linked = Boolean(grant.accountId);
  const requested = detectOrderChange(customerTexts);
  const via = `${grant.sender.channel}:${grant.sender.handle}`;

  async function openForChange(orderId: string, kind: OrderChangeKind, asked: OrderChangeKind[]): Promise<{ order: Order } | ToolRun> {
    const id = cleanOrderId(orderId);
    const order = id ? await findOrder(id) : undefined;
    const access = order ? orderAccess(grant, order) : undefined;
    if (!id || !order || !access?.ok) {
      return { output: denial(id ?? orderId, access && !access.ok ? access.reason : "not_owner", linked), access: "denied", summary: `#${id ?? orderId} — not linked to this sender` };
    }
    ledger.openedOrders.set(order.id, order);
    if (access.identity.method === "stated_email_and_phone") {
      return {
        output: { changed: false, reason: "Orders can only be changed from the phone number, email or Instagram account the order was placed with. Ask the customer to write from that account." },
        access: "refused",
        summary: `#${order.id} — change needs the buyer's own channel`,
      };
    }
    if (!asked.some((k) => requested.includes(k))) {
      return {
        output: { changed: false, reason: "The customer hasn't asked for this in their own messages. Ask what they want changed; never change an order on your own initiative." },
        access: "refused",
        summary: `#${order.id} — ${kind.replace("_", " ")} not requested by the customer`,
      };
    }
    if (ledger.traces.filter((t) => CHANGE_TOOLS.includes(t.tool) && t.access === "action").length >= MAX_CHANGES_PER_REPLY) {
      return { output: { changed: false, reason: "Too many changes in one reply. Confirm what's done so far and let the customer ask for the rest." }, access: "refused", summary: `#${order.id} — change limit for one reply` };
    }
    return { order };
  }

  function staffOrRefuse(order: Order, allowed: boolean, summary: string): ToolRun | undefined {
    if (allowed) return undefined;
    const options = changeOptions(order, policies);
    return {
      output: options.staff_handles
        ? { changed: false, staff_handoff_required: `${options.staff_handles} Call request_human with what the customer wants.` }
        : { changed: false, reason: options.note ?? "This change isn't possible for this order." },
      access: "refused",
      summary: `#${order.id} — ${summary}`,
    };
  }

  async function afterChange(order: Order, action: { label: string; detail: string }) {
    const fresh = (await findOrder(order.id)) ?? order;
    ledger.openedOrders.set(fresh.id, fresh);
    ledger.actions.push({ kind: "order_change", ...action });
    return fresh;
  }

  return {
    get_my_account: tool({
      description:
        "The writer's own profile (only for a linked account).",
      inputSchema: z.object({}),
      execute: () =>
        traced("get_my_account", {}, async () => {
          if (!grant.accountId) return { output: NO_ACCOUNT, access: "denied", summary: "No linked account" };
          const [customer, orders] = await Promise.all([findCustomer(grant.accountId), ordersOfCustomer(grant.accountId)]);
          if (!customer) return { output: NO_ACCOUNT, access: "denied", summary: "No linked account" };
          return { output: accountView(customer, orders.length), access: "granted", summary: `Own profile (${orders.length} orders)` };
        }),
    }),

    list_my_orders: tool({
      description:
        "The writer's own orders, optionally by status (only for a linked account).",
      inputSchema: z.object({
        status: z.enum(ORDER_STATUSES).optional().describe("Only orders with this status."),
        limit: z.number().int().min(1).max(20).optional().describe("Maximum number of orders (default 10)."),
      }),
      execute: ({ status, limit }) =>
        traced("list_my_orders", { status, limit }, async () => {
          if (!grant.accountId) return { output: NO_ACCOUNT, access: "denied", summary: "No linked account" };
          const all = await ordersOfCustomer(grant.accountId);
          const picked = all.filter((o) => !status || o.status === status).slice(0, limit ?? 10);
          for (const o of picked) ledger.openedOrders.set(o.id, o);
          const given = await vouchersForOrders(picked.map((o) => o.id));
          return {
            output: {
              orders_on_file: all.length,
              ...(status ? { matching_status: picked.length } : {}),
              orders: picked.map((o) => ({ ...orderSummary(o, today, policies), ...compensationGiven(given.get(o.id)) })),
            },
            access: "granted",
            summary: `${picked.length} of ${all.length} own orders${status ? ` (${status})` : ""}`,
          };
        }),
    }),

    get_order: tool({
      description:
        "Full details of one order (items, delivery, courier, address, payment, return eligibility, warranty). Only opens the writer's own orders.",
      inputSchema: z.object({ order_id: orderIdSchema }),
      execute: ({ order_id }) =>
        traced("get_order", { order_id }, async () => {
          const id = cleanOrderId(order_id);
          if (!id) return { output: { error: "Not a valid order number." }, access: "refused", summary: `Invalid order number “${order_id}”` };
          const order = await findOrder(id);
          const access = order ? orderAccess(grant, order) : ({ ok: false, reason: "not_owner" } as const);
          if (!order || !access.ok) {
            const reason = access.ok ? "not_owner" : access.reason;
            return {
              output: denial(id, reason, linked),
              access: "denied",
              summary: `#${id} — ${reason === "third_party" ? "writer is acting for someone else" : "not linked to this sender"}`,
            };
          }
          ledger.openedOrders.set(order.id, order);
          const view = { ...orderDetail(order, today, policies, { boxOpened: grant.signals.boxOpened, product: grant.signals.product }), ...compensationGiven(await voucherForOrder(order.id)) };
          return {
            output: { access: "granted", verified_by: access.identity.method?.replaceAll("_", " "), ...view },
            access: "granted",
            summary: `#${order.id} · ${order.status}${view.delivery.days_late ? ` · ${view.delivery.days_late} days late` : ""}`,
          };
        }),
    }),

    search_products: tool({
      description:
        "Search the public product catalog: names, prices (EUR), stock.",
      inputSchema: z.object({
        query: z.string().max(80).optional().describe('Brand, model or words from the product name, e.g. "sony", "iphone 15".'),
        category: z.enum(PRODUCT_CATEGORIES).optional(),
        min_price_eur: z.number().min(0).optional(),
        max_price_eur: z.number().min(0).optional(),
        in_stock_only: z.boolean().optional(),
      }),
      execute: ({ query, category, min_price_eur, max_price_eur, in_stock_only }) =>
        traced("search_products", { query, category, min_price_eur, max_price_eur, in_stock_only }, async () => {
          const products = await searchProducts({
            text: query,
            category,
            minPrice: min_price_eur,
            maxPrice: max_price_eur,
            inStockOnly: in_stock_only,
            limit: 8,
          });
          return {
            output: { results: products.length, products: products.map(productView) },
            access: "public",
            summary: `${products.length} products${category ? ` · ${category}` : ""}${query ? ` · “${query}”` : ""}`,
          };
        }),
    }),

    open_carrier_trace: tool({
      description:
        "Ask the courier to trace the writer's own late, shipped order. Returns a trace reference.",
      inputSchema: z.object({ order_id: orderIdSchema }),
      execute: ({ order_id }) =>
        traced("open_carrier_trace", { order_id }, async () => {
          const id = cleanOrderId(order_id);
          const order = id ? await findOrder(id) : undefined;
          const access = order ? orderAccess(grant, order) : undefined;
          if (!id || !order || !access?.ok) {
            return { output: denial(id ?? order_id, access && !access.ok ? access.reason : "not_owner", linked), access: "denied", summary: `#${id ?? order_id} — not linked to this sender` };
          }
          const delivery = deliveryView(order, today, policies);
          if (!delivery.carrier_trace_available) {
            const why = delivery.staff_handoff_required
              ? `${delivery.staff_handoff_required} Call request_human instead.`
              : delivery.state === "preparing"
                ? "The order hasn't shipped yet, so there is no parcel to trace."
                : "The parcel isn't late, so there is nothing to trace.";
            return { output: { opened: false, reason: why }, access: "refused", summary: `#${order.id} — trace not allowed` };
          }
          const trace_id = `TRC-${order.id}`;
          if (!ledger.actions.some((a) => a.kind === "carrier_trace")) {
            ledger.actions.push({ kind: "carrier_trace", label: "Carrier trace opened", detail: `${trace_id} with ${order.shipment!.carrier}` });
          }
          ledger.openedOrders.set(order.id, order);
          return {
            output: { opened: true, trace_id, courier: order.shipment!.carrier },
            access: "action",
            summary: `${trace_id} with ${order.shipment!.carrier}`,
          };
        }),
    }),

    issue_delay_voucher: tool({
      description:
        "Give the delay voucher (delay_compensation policy) for the writer's own late order. One per order; code shown on a card, never in text.",
      inputSchema: z.object({ order_id: orderIdSchema }),
      execute: ({ order_id }) =>
        traced("issue_delay_voucher", { order_id }, async () => {
          const policy = policies.delayCompensation;
          if (!policy) {
            return { output: { issued: false, reason: "There is no delay compensation policy on file." }, access: "refused", summary: "No delay policy on file" };
          }
          const id = cleanOrderId(order_id);
          const order = id ? await findOrder(id) : undefined;
          const access = order ? orderAccess(grant, order) : undefined;
          if (!id || !order || !access?.ok) {
            return { output: denial(id ?? order_id, access && !access.ok ? access.reason : "not_owner", linked), access: "denied", summary: `#${id ?? order_id} — not linked to this sender` };
          }
          const delivery = deliveryView(order, today, policies);
          if (!delivery.delay_voucher_eligible) {
            const existing = await voucherForOrder(order.id);
            if (!existing) {
              return {
                output: { issued: false, reason: delivery.state === "delivered" ? "The order was delivered; the voucher is only for orders that are late or held by the carrier right now." : "The order isn't late, so it doesn't qualify." },
                access: "refused",
                summary: `#${order.id} — not delayed`,
              };
            }
          }
          const reward = delayReward(order, delivery.days_late ?? 0, policies) ?? { kind: "percent" as const, percent: policy.percent };
          const { voucher, alreadyIssued } = await issueDelayVoucher({ order, reward, validDays: policy.validDays, now: grant.now, today });
          const issued = voucher.kind === "percent" ? { kind: "percent" as const, percent: voucher.percent ?? policy.percent } : voucher.kind === "gift_card" ? { kind: "gift_card" as const, amountEur: voucher.amountEur ?? 0 } : { kind: "free_shipping" as const };
          const what = rewardLabel(issued);
          const card = { code: voucher.code, kind: voucher.kind, percent: voucher.percent, amountEur: voucher.amountEur, orderId: order.id, expiresOn: isoDay(voucher.expiresOn), alreadyIssued };
          if (!ledger.vouchers.some((v) => v.orderId === order.id)) ledger.vouchers.push(card);
          if (!alreadyIssued) ledger.actions.push({ kind: "voucher", label: `Delay voucher issued: ${what}`, detail: `For order #${order.id}, valid until ${card.expiresOn}` });
          ledger.openedOrders.set(order.id, order);
          return {
            output: {
              issued: !alreadyIssued,
              already_issued_earlier: alreadyIssued,
              voucher: { reward: what, valid_until: card.expiresOn, shown_to_customer_as_card: true, redeemed: voucher.redeemed },
              rules: "One voucher per delayed order. Not cash, not transferable, not combined with other vouchers.",
            },
            access: "action",
            summary: `${what} for #${order.id}${alreadyIssued ? " (already issued — same voucher shown)" : ""}`,
          };
        }),
    }),

    change_delivery_address: tool({
      description:
        "Change the delivery address of the writer's own order before it ships. The address must be exactly as the customer wrote it.",
      inputSchema: z.object({
        order_id: orderIdSchema,
        new_address: z.string().max(160).describe("The new address, copied exactly from the customer's message."),
      }),
      execute: ({ order_id, new_address }, { abortSignal }) =>
        traced("change_delivery_address", { order_id }, async () => {
          const opened = await openForChange(order_id, "address", ["address", "general"]);
          if (!("order" in opened)) return opened;
          const { order } = opened;
          const blocked = staffOrRefuse(order, changeOptions(order, policies).change_address, "address can't be changed here");
          if (blocked) return blocked;
          const address = cleanAddress(new_address);
          if (!address) {
            return { output: { changed: false, reason: "That doesn't look like a delivery address. Ask the customer for the full street, number and town." }, access: "refused", summary: `#${order.id} — address not usable` };
          }
          if (!writtenByCustomer(address, customerTexts)) {
            return {
              output: { changed: false, reason: "The new address must be copied exactly from the customer's own message. Ask them to write the full new address." },
              access: "refused",
              summary: `#${order.id} — address not written by the customer`,
            };
          }
          if (fold(address) === fold(order.buyer.address)) {
            const last = await lastOrderChange(order.id);
            if (last?.kind === "address" && last.via === via && fold(last.after) === fold(address)) {
              ledger.changes.push({ kind: "address", orderId: order.id, address: order.buyer.address });
              return { output: { changed: true, order_id: order.id, shipping_address: order.buyer.address, status: order.status }, access: "action", summary: `#${order.id} — delivery address changed` };
            }
            return { output: { changed: false, reason: "That is already the delivery address on the order." }, access: "refused", summary: `#${order.id} — same address` };
          }
          const limit = policies.orderChanges!.maxAddressChanges;
          if ((await countOrderChanges(order.id, "address")) >= limit) {
            return {
              output: { changed: false, staff_handoff_required: `The address on this order has already been changed ${limit} times. Call request_human so a colleague confirms the address with the customer.` },
              access: "refused",
              summary: `#${order.id} — address change limit reached`,
            };
          }
          const ctx = { order, via, now: grant.now, statuses: policies.orderChanges!.editableStatuses };
          if (abortSignal?.aborted) return { output: { changed: false, reason: "Stopped before changing anything." }, access: "refused", summary: `#${order.id} — stopped` };
          if (!(await changeShipAddress(ctx, address))) {
            return { output: { changed: false, staff_handoff_required: "The order changed while updating (it may have just shipped). Call request_human." }, access: "refused", summary: `#${order.id} — address update didn't apply` };
          }
          ledger.changes.push({ kind: "address", orderId: order.id, address });
          await afterChange(order, { label: "Delivery address changed", detail: `Order #${order.id}, requested via ${grant.sender.channel} ${grant.sender.handle}` });
          return {
            output: { changed: true, order_id: order.id, shipping_address: address, status: order.status },
            access: "action",
            summary: `#${order.id} — delivery address changed`,
          };
        }),
    }),

    remove_order_item: tool({
      description:
        "Remove an item, or some of its units, from the writer's own order before it ships. Only for orders whose changes allow it.",
      inputSchema: z.object({
        order_id: orderIdSchema,
        item: z.string().max(120).describe("The product name as it appears on the order."),
        quantity: z.number().int().min(1).max(50).optional().describe("How many units to remove (default: all of them)."),
      }),
      execute: ({ order_id, item, quantity }, { abortSignal }) =>
        traced("remove_order_item", { order_id, item, quantity }, async () => {
          const opened = await openForChange(order_id, "remove_item", ["remove_item", "cancel", "general"]);
          if (!("order" in opened)) return opened;
          const { order } = opened;
          const blocked = staffOrRefuse(order, changeOptions(order, policies).remove_items, "items can't be removed here");
          if (blocked) return blocked;
          const match = findItem(order, item);
          if (Array.isArray(match)) {
            return { output: { changed: false, reason: "Say which item exactly.", items_on_order: order.items.map((i) => ({ name: i.name, qty: i.qty })) }, access: "refused", summary: `#${order.id} — item unclear` };
          }
          if (!mentionedByCustomer(match, order, customerTexts)) {
            return { output: { changed: false, reason: `The customer hasn't said they want ${match.name} removed. Ask them to confirm which item.` }, access: "refused", summary: `#${order.id} — item not named by the customer` };
          }
          const qty = Math.min(quantity ?? match.qty, match.qty);
          if (order.items.length === 1 && qty === match.qty) {
            return { output: { changed: false, reason: "That would leave the order empty. If the customer wants nothing from it, that's a cancellation (cancel_order), once they ask for it." }, access: "refused", summary: `#${order.id} — would empty the order` };
          }
          const ctx = { order, via, now: grant.now, statuses: policies.orderChanges!.editableStatuses, payments: policies.orderChanges!.selfServicePayments };
          if (abortSignal?.aborted) return { output: { changed: false, reason: "Stopped before changing anything." }, access: "refused", summary: `#${order.id} — stopped` };
          if (!(await removeOrderItem(ctx, match, qty))) {
            return { output: { changed: false, staff_handoff_required: "The order changed while updating (it may have just shipped). Call request_human." }, access: "refused", summary: `#${order.id} — removal didn't apply` };
          }
          const fresh = await afterChange(order, { label: qty === match.qty ? "Item removed from order" : "Quantity lowered", detail: `Order #${order.id}: ${qty}× ${match.name}` });
          const totalEur = Math.round(fresh.items.reduce((s, i) => s + i.qty * i.price, 0) * 100) / 100;
          ledger.changes.push({ kind: "remove_item", orderId: order.id, name: match.name, qty, totalEur });
          return {
            output: {
              changed: true,
              order_id: order.id,
              removed: { name: match.name, qty },
              items_now: fresh.items.map((i) => ({ name: i.name, qty: i.qty, unit_price_eur: i.price })),
              new_total_eur: totalEur,
              payment: "Cash on delivery: nothing was paid yet, so the courier collects the new total.",
            },
            access: "action",
            summary: `#${order.id} — removed ${qty}× ${match.name}`,
          };
        }),
    }),

    cancel_order: tool({
      description:
        "Cancel the writer's own order before it ships, only after the customer clearly asked to cancel it. Only for orders whose changes allow it.",
      inputSchema: z.object({ order_id: orderIdSchema }),
      execute: ({ order_id }, { abortSignal }) =>
        traced("cancel_order", { order_id }, async () => {
          const opened = await openForChange(order_id, "cancel", ["cancel"]);
          if (!("order" in opened)) return opened;
          const { order } = opened;
          if (order.status === "cancelled") {
            const last = await lastOrderChange(order.id);
            if (last?.kind === "cancel" && last.via === via) {
              ledger.changes.push({ kind: "cancel", orderId: order.id });
              return { output: { cancelled: true, order_id: order.id, payment: "Cash on delivery: nothing has been paid for this order." }, access: "action", summary: `#${order.id} — cancelled` };
            }
          }
          const blocked = staffOrRefuse(order, changeOptions(order, policies).cancel, "can't be cancelled here");
          if (blocked) return blocked;
          const ctx = { order, via, now: grant.now, statuses: policies.orderChanges!.editableStatuses, payments: policies.orderChanges!.selfServicePayments };
          if (abortSignal?.aborted) return { output: { changed: false, reason: "Stopped before changing anything." }, access: "refused", summary: `#${order.id} — stopped` };
          if (!(await cancelOrder(ctx))) {
            return { output: { changed: false, staff_handoff_required: "The order changed while cancelling (it may have just shipped). Call request_human." }, access: "refused", summary: `#${order.id} — cancellation didn't apply` };
          }
          ledger.changes.push({ kind: "cancel", orderId: order.id });
          await afterChange(order, { label: "Order cancelled", detail: `Order #${order.id}, requested via ${grant.sender.channel} ${grant.sender.handle}` });
          return {
            output: { cancelled: true, order_id: order.id, payment: "Cash on delivery: nothing has been paid for this order." },
            access: "action",
            summary: `#${order.id} — cancelled`,
          };
        }),
    }),

    request_human: tool({
      description:
        "Hand the conversation to a person. Rare: see the handoff rules.",
      inputSchema: z.object({
        reason: z.string().min(3).max(400).describe("One or two sentences for the colleague: what the customer needs and what you already checked."),
        priority: z.enum(["normal", "urgent"]).describe("urgent = upset customer, lost/late parcel or anything time-critical."),
      }),
      execute: ({ reason, priority }) =>
        traced("request_human", { priority }, async () => {
          const slaHours = priority === "urgent" ? OPS.urgentSlaHours : OPS.standardSlaHours;
          const queue = priority === "urgent" ? "Senior support" : "Support team";
          const who = `${grant.sender.displayName} (${grant.sender.channel} ${grant.sender.handle})`;
          const next = { priority, queue, slaHours, note: `${who}: ${reason.trim()}` } as const;
          if (!ledger.handoff || (priority === "urgent" && ledger.handoff.priority !== "urgent")) ledger.handoff = { ...next };
          return {
            output: { handed_over: true, team: queue, reply_within_hours: ledger.handoff.slaHours },
            access: "action",
            summary: `${queue} · ${priority} · ${ledger.handoff.slaHours}h`,
          };
        }),
    }),
  };
}

export type SupportTools = ReturnType<typeof createSupportTools>;
export const TOOL_NAMES = [
  "get_my_account",
  "list_my_orders",
  "get_order",
  "search_products",
  "open_carrier_trace",
  "issue_delay_voucher",
  "change_delivery_address",
  "remove_order_item",
  "cancel_order",
  "request_human",
] as const;
