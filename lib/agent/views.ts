import type { Customer, DelayReward, Order, Product, Voucher } from "@/lib/db/repo";
import { expectedWindowFor } from "@/lib/engine/rules";
import { daysBetween, isoDay } from "@/lib/engine/text";
import type { ProductCategory } from "@/lib/engine/types";
import { OPS } from "@/lib/shop/operations";
import type { PolicyBook } from "@/lib/shop/policies";

/*
 * What the tools hand the model. Every derived value (days late, return
 * eligibility, warranty) is computed here, in code, from records and the
 * policies table — the model narrates facts, it never works them out.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DeliveryView {
  state: "delivered" | "in_transit" | "preparing" | "cancelled" | "returned" | "courier_problem";
  courier?: string;
  courier_status?: string;
  last_courier_update?: string;
  shipped_on?: string;
  expected_between?: [string, string];
  days_late?: number;
  delivered_on?: string;
  days_since_delivery?: number;
  /** Code says a person must take this over (only for courier failures now). */
  staff_handoff_required?: string;
  /** Code says a carrier trace may be opened (shipped and late). */
  carrier_trace_available?: boolean;
  /** Code says the delay-compensation voucher applies (late, or held by the carrier). */
  delay_voucher_eligible?: boolean;
  delay_voucher_reward?: string;
  note?: string;
}

export function delayReward(o: Order, daysLate: number, policies: PolicyBook): DelayReward | undefined {
  const p = policies.delayCompensation;
  if (!p) return undefined;
  const total = o.items.reduce((sum, i) => sum + i.qty * i.price, 0);
  const fits = p.tiers.filter((t) => daysLate >= t.minDaysLate && total >= t.minOrderEur);
  const gift = fits.find((t) => t.reward === "gift_card");
  if (gift?.amountEur) return { kind: "gift_card", amountEur: gift.amountEur };
  if (fits.some((t) => t.reward === "free_shipping")) return { kind: "free_shipping" };
  return { kind: "percent", percent: p.percent };
}

export function rewardLabel(r: DelayReward): string {
  return r.kind === "percent" ? `${r.percent}% off the next order` : r.kind === "free_shipping" ? "free shipping on the next order" : `a €${r.amountEur} gift card`;
}

export function voucherReward(v: Voucher): DelayReward {
  if (v.kind === "gift_card") return { kind: "gift_card", amountEur: v.amountEur ?? 0 };
  if (v.kind === "free_shipping") return { kind: "free_shipping" };
  return { kind: "percent", percent: v.percent ?? 0 };
}

export function compensationGiven(v: Voucher | undefined) {
  if (!v) return {};
  return {
    delay_compensation_already_given: {
      reward: rewardLabel(voucherReward(v)),
      valid_until: isoDay(v.expiresOn),
      used: v.redeemed,
      note: "This delay was already compensated. Only one voucher per order: never offer another.",
    },
  };
}

export function deliveryView(o: Order, today: Date, policies: PolicyBook): DeliveryView {
  if (o.status === "cancelled" || o.status === "returned") {
    return { state: o.status, note: `The order is ${o.status}. You can tell the customer that; moving any money for it is done by staff.` };
  }
  const ship = o.shipment;
  const courier = ship ? { courier: ship.carrier, courier_status: ship.tracking, last_courier_update: isoDay(ship.lastUpdate), shipped_on: isoDay(ship.shippedAt) } : {};
  if (o.deliveredAt || o.status === "delivered") {
    const at = o.deliveredAt ?? ship?.lastUpdate ?? o.placedAt;
    return { ...courier, state: "delivered", delivered_on: isoDay(at), days_since_delivery: daysBetween(at, today) };
  }
  if (ship && (ship.tracking === "failed_delivery" || ship.tracking === "returned_to_sender")) {
    return {
      ...courier,
      state: "courier_problem",
      delay_voucher_eligible: true,
      staff_handoff_required: `The courier reports ${ship.tracking.replaceAll("_", " ")}; staff arrange re-delivery with the customer.`,
    };
  }
  const window = expectedWindowFor(o, policies);
  const view: DeliveryView = { ...courier, state: ship ? "in_transit" : "preparing" };
  if (!window) return view;
  view.expected_between = [isoDay(window.from), isoDay(window.by)];
  const late = daysBetween(window.by, today);
  if (late > 0) {
    view.days_late = late;
    view.delay_voucher_eligible = true;
    const reward = delayReward(o, late, policies);
    if (reward) view.delay_voucher_reward = rewardLabel(reward);
    if (ship) view.carrier_trace_available = true;
    else view.note = "Not shipped yet although the delivery window has passed.";
    if (late > OPS.lateHandoffDays) view.note = `Very late (more than ${OPS.lateHandoffDays} days). Trace it and offer the voucher; hand off only if the customer asks for more than that.`;
  }
  return view;
}

export interface ReturnView {
  eligible: boolean;
  /** Why not: past_window, opened (per record), opened_per_customer, not_delivered_yet. */
  reasons: string[];
  days_left_in_window?: number;
}

function returnView(o: Order, item: Order["items"][number], today: Date, policies: PolicyBook, claimedOpened: boolean): ReturnView | undefined {
  const r = policies.returns;
  if (!r) return undefined;
  if (!o.deliveredAt) return { eligible: false, reasons: ["not_delivered_yet"] };
  const days = daysBetween(o.deliveredAt, today);
  const reasons: string[] = [];
  if (days > r.windowDays) reasons.push("past_window");
  if (r.unopenedOnly && item.opened) reasons.push("opened");
  // The customer's own word only ever counts against them.
  if (r.unopenedOnly && !item.opened && claimedOpened) reasons.push("opened_per_customer");
  return { eligible: reasons.length === 0, reasons, ...(days <= r.windowDays ? { days_left_in_window: r.windowDays - days } : {}) };
}

function warrantyView(o: Order, today: Date, policies: PolicyBook) {
  const w = policies.warranty;
  if (!w) return undefined;
  if (w.kind === "human_staff") return { handled_by: "staff", note: w.text };
  const since = daysBetween(o.deliveredAt ?? o.placedAt, today);
  const monthsLeft = w.months - Math.floor(since / 30);
  return { months: w.months, months_left: Math.max(0, monthsLeft), covered: monthsLeft > 0 };
}

export interface ChangeOptionsView {
  change_address: boolean;
  remove_items: boolean;
  cancel: boolean;
  staff_handles?: string;
  note?: string;
}

export function changeOptions(o: Order, policies: PolicyBook): ChangeOptionsView {
  const p = policies.orderChanges;
  if (!p) return { change_address: false, remove_items: false, cancel: false, staff_handles: "There is no written policy on changing orders, so staff handle any change." };
  if (o.status === "cancelled" || o.status === "returned") return { change_address: false, remove_items: false, cancel: false, note: `The order is ${o.status}; there is nothing left to change.` };
  if (o.status === "delivered") return { change_address: false, remove_items: false, cancel: false, note: "Already delivered: this is a return, not a change. Use the item's return eligibility." };
  if (!(p.editableStatuses as string[]).includes(o.status)) {
    return { change_address: false, remove_items: false, cancel: false, staff_handles: "The order has already shipped, so staff arrange any change with the courier." };
  }
  const selfService = (p.selfServicePayments as string[]).includes(o.paymentMethod);
  return {
    change_address: true,
    remove_items: selfService && (o.items.length > 1 || o.items.some((i) => i.qty > 1)),
    cancel: selfService,
    ...(selfService ? {} : { staff_handles: "This order was paid by card or bank transfer, so staff complete any removal or cancellation. The address can still be changed." }),
  };
}

export function orderSummary(o: Order, today: Date, policies: PolicyBook) {
  return {
    order_id: o.id,
    placed_on: isoDay(o.placedAt),
    status: o.status,
    items: o.items.map((i) => ({ name: i.name, qty: i.qty, unit_price_eur: round2(i.price) })),
    total_eur: round2(o.items.reduce((sum, i) => sum + i.qty * i.price, 0)),
    delivery: deliveryView(o, today, policies),
    changes: changeOptions(o, policies),
  };
}

/**
 * Full detail for the verified owner, including their own address and contact
 * details on the order. Only ever built after `orderAccess()` said yes.
 */
export function orderDetail(
  o: Order,
  today: Date,
  policies: PolicyBook,
  claims: { boxOpened: boolean | null; product?: ProductCategory },
) {
  const claimApplies = (category: ProductCategory) =>
    claims.boxOpened === true && (claims.product ? claims.product === category : o.items.length === 1);
  return {
    ...orderSummary(o, today, policies),
    items: o.items.map((i) => ({
      name: i.name,
      category: i.category,
      qty: i.qty,
      unit_price_eur: round2(i.price),
      opened_per_record: i.opened,
      return: returnView(o, i, today, policies, claimApplies(i.category)),
    })),
    payment_method: o.paymentMethod.replaceAll("_", " "),
    shipping_address: o.buyer.address,
    buyer: { name: o.buyer.name, email: o.buyer.email ?? null, phone: o.buyer.phone ?? null },
    warranty: warrantyView(o, today, policies),
  };
}

export function accountView(c: Customer, orderCount: number) {
  return {
    name: c.name,
    email: c.email ?? null,
    phone: c.phone ?? null,
    instagram: c.instagram ?? null,
    preferred_language: c.language === "sq" ? "Albanian" : "English",
    orders_on_file: orderCount,
  };
}

export function productView(p: Product) {
  return {
    name: p.name,
    category: p.category,
    price_eur: round2(p.price),
    stock: p.stock === undefined ? "not tracked" : p.stock > 0 ? "in stock" : "out of stock",
    units_available: p.stock ?? null,
  };
}
