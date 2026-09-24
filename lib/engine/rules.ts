import type { Order } from "@/lib/db/repo";
import { covers, policyText } from "@/lib/shop/policies";
import { OPS } from "@/lib/shop/operations";
import { focusItem, type FactSheet } from "./facts";
import { requiredTopic, topicInfo } from "./topics";
import { addDays, addWorkingDays, daysBetween, formatDay, isoDay, maskEmail, maskPhone, plural } from "./text";
import {
  STRICTNESS,
  type Action,
  type Decision,
  type Fact,
  type Handoff,
  type ReplyBrief,
  type RuleCheck,
  type RuleId,
  type Sender,
  type Signals,
} from "./types";

/*
 * The deterministic decision. Rules are evaluated in a fixed order and the
 * strictest decision among the ones that fire wins. This is the floor: the
 * guard lets a model make a decision stricter, never looser.
 *
 * Every fact comes from the FactSheet (database records) and every policy value
 * from the policies table. Nothing here knows a specific order or customer.
 */

export const RULES: Record<RuleId, { title: string; decision: Decision; description: string }> = {
  R1: {
    title: "Anger or repeat contact → human",
    decision: "escalate",
    description: "Any sign the customer is upset or has written before goes straight to a person. No automated answer is attempted.",
  },
  R2: {
    title: "No written policy → human",
    decision: "escalate",
    description: "If no row in the policies table covers the question, the agent never guesses.",
  },
  R3: {
    title: "Order details only to the verified buyer",
    decision: "request_verification",
    description:
      "An order's status, return, warranty, address, phone and email are shared only when the requester is the buyer on that order.",
  },
  R4: {
    title: "Facts must exist before answering",
    decision: "request_verification",
    description: "If the order or the buyer's identity can't be confirmed from records, ask for it instead of assuming.",
  },
  R5: {
    title: "Policy limit reached → human",
    decision: "escalate",
    description: `Cases the policy hands to staff: defective items, cancelled orders, courier problems, or a parcel more than ${OPS.lateHandoffDays} days past its expected date.`,
  },
  R6: {
    title: "Policy answers it → reply",
    decision: "resolve",
    description: "Verified facts plus written policy fully answer the message.",
  },
};

export interface RulesOutcome {
  decision: Decision;
  fired: RuleId;
  checks: RuleCheck[];
  brief: ReplyBrief;
  facts: Fact[];
  actions: Action[];
  withheld: string[];
  handoff?: Handoff;
  summary: string;
}

interface PathResult {
  rule: RuleId;
  brief: ReplyBrief;
  summary: string;
  facts: Fact[];
  actions?: Action[];
  withheld?: string[];
  handoff?: Handoff;
}


const fmtDate = (d: Date) => formatDay(d, "en");
const firstName = (o: Order) => o.buyer.name.split(" ")[0];
const PII_LABEL = { address: "delivery address", phone: "phone number", email: "email" } as const;
const STATUS_LABEL: Record<Order["status"], string> = {
  pending: "awaiting processing",
  processing: "being prepared",
  shipped: "shipped",
  delivered: "delivered",
  cancelled: "cancelled",
  returned: "returned",
};

function brief(
  kind: ReplyBrief["kind"],
  decision: Decision,
  outcome: string,
  params: ReplyBrief["params"] = {},
  extra: Partial<Pick<ReplyBrief, "disclose" | "withhold">> = {},
): ReplyBrief {
  return { kind, decision, outcome, params, disclose: extra.disclose ?? [], withhold: extra.withhold ?? [] };
}

function allPii(order?: Order): string[] {
  return order ? [order.buyer.address, order.buyer.phone, order.buyer.email].filter((v): v is string => Boolean(v)) : [];
}

function itemsLabel(order: Order): string {
  return order.items.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(", ") || "No items";
}

function orderFact(order: Order): Fact {
  const tracking = order.shipment && order.status === "shipped" ? ` (${order.shipment.tracking.replaceAll("_", " ")})` : "";
  return { label: `Order #${order.id}`, value: `${itemsLabel(order)} · ${STATUS_LABEL[order.status]}${tracking}`, source: "orders" };
}

function identityFact(sheet: FactSheet, sender: Sender): Fact {
  const id = sheet.identity;
  if (!id || !sheet.order) return { label: "Requester = buyer?", value: "No order to compare against", source: "computed" };
  const buyer = sheet.order.buyer;
  if (id.verified) {
    const how = {
      linked_account: `${sender.channel} ${sender.handle} belongs to the buyer's customer record`,
      channel_phone: `Viber number matches buyer phone (${maskPhone(buyer.phone ?? "")})`,
      channel_email: `Sender address matches buyer email (${maskEmail(buyer.email ?? "?@?")})`,
      channel_instagram: `Instagram account matches the buyer's (${buyer.instagram})`,
      stated_email_and_phone: "Stated email and phone both match the buyer record",
    }[id.method!];
    return { label: "Requester = buyer?", value: `Yes — ${how}`, source: "computed", tone: "ok" };
  }
  const reasons: string[] = [];
  if (id.thirdParty) reasons.push("says they are writing for someone else");
  if (!id.channelMatch) {
    reasons.push(sender.customerId ? `${sender.channel} ${sender.handle} belongs to a different customer` : `${sender.channel} ${sender.handle} isn't in the customer records`);
  }
  if (id.statedEmailMatch !== id.statedPhoneMatch) reasons.push("only one of email/phone stated");
  return { label: "Requester = buyer?", value: `No — ${reasons.join("; ")}`, source: "computed", tone: "bad" };
}

function greetName(sheet: FactSheet): string | undefined {
  return sheet.order && sheet.identity?.verified ? firstName(sheet.order) : undefined;
}

function handoff(priority: Handoff["priority"], note: string, queue?: string): Handoff {
  return {
    priority,
    queue: queue ?? (priority === "urgent" ? "Senior support" : "Support team"),
    slaHours: priority === "urgent" ? OPS.urgentSlaHours : OPS.standardSlaHours,
    note,
  };
}

/** When a policy row exists but its value can't be computed with, a person answers. */
function unreadablePolicy(topic: string, sender: Sender): PathResult {
  return {
    rule: "R5",
    brief: brief("escalate_review", "escalate", "Policy needs a person", { slaHours: OPS.standardSlaHours }),
    summary: `The “${topic}” policy exists, but its value in the policies table can't be read as numbers, so the agent can't compute an answer. Rule R5: hand to staff.`,
    facts: [{ label: "Policy value", value: `“${topic}” is not machine-readable`, source: "policy", tone: "bad" }],
    handoff: handoff("normal", `${sender.displayName} asked about ${topic}; the policy value in the database couldn't be read.`),
  };
}

/** The dates an order should arrive between: the shipment's window, else order date + delivery policy. */
function expectedWindow(order: Order, sheet: FactSheet): { from: Date; by: Date; source: "orders" | "computed" } | undefined {
  if (order.shipment) return { from: order.shipment.expectedMin, by: order.shipment.expectedMax, source: "orders" };
  const d = sheet.policies.delivery;
  if (!d) return undefined;
  const add = d.workingDays ? addWorkingDays : addDays;
  return { from: add(order.placedAt, d.minDays), by: add(order.placedAt, d.maxDays), source: "computed" };
}

// ---- paths per intent --------------------------------------------------------

function needOrder(sheet: FactSheet, forWhat: string): PathResult | undefined {
  if (sheet.orderMatch === "id_not_found") {
    return {
      rule: "R4",
      brief: brief("order_not_found", "request_verification", "Order number not found", { orderId: sheet.requestedOrderId }),
      summary: `Order #${sheet.requestedOrderId} doesn't exist in the orders table, so nothing can be confirmed. Rule R4: ask the customer to double-check instead of guessing.`,
      facts: [{ label: `Order #${sheet.requestedOrderId}`, value: "Not found in records", source: "orders", tone: "bad" }],
    };
  }
  if (!sheet.order) {
    return {
      rule: "R4",
      brief: brief("need_order_number", "request_verification", "Order number requested"),
      summary: `No order number was given and the sender isn't linked to any order, so the ${forWhat} can't be checked. Rule R4: ask for the order number.`,
      facts: [{ label: "Order", value: "None referenced, none linked to this sender", source: "orders", tone: "warn" }],
    };
  }
  return undefined;
}

function orderStatusPath(sheet: FactSheet, signals: Signals, sender: Sender): PathResult {
  const missing = needOrder(sheet, "delivery status");
  if (missing) return missing;
  const delivery = sheet.policies.delivery;
  if (!delivery) return unreadablePolicy("delivery", sender);
  const order = sheet.order!;
  const { today } = sheet;
  const placedDays = daysBetween(order.placedAt, today);
  const shippedDays = order.shipment ? daysBetween(order.shipment.shippedAt, today) : undefined;
  const facts: Fact[] = [
    orderFact(order),
    { label: "Ordered", value: `${fmtDate(order.placedAt)} — ${plural(placedDays, "day", "days")} ago`, source: "orders" },
    { label: "Delivery policy", value: delivery.text, source: "policy" },
  ];
  if (order.shipment) {
    facts.push({
      label: "Shipped",
      value: `${fmtDate(order.shipment.shippedAt)} with ${order.shipment.carrier} — ${plural(shippedDays!, "day", "days")} ago`,
      source: "orders",
    });
  }
  if (signals.statedDays !== undefined) {
    const matches = signals.statedDays === placedDays ? " (matches days since ordering)" : signals.statedDays === shippedDays ? " (matches days since shipping)" : ` (record: ordered ${placedDays} days ago)`;
    facts.push({ label: "Customer says", value: `${plural(signals.statedDays, "day", "days")}${matches}`, source: "customer", tone: "neutral" });
  }
  const base = {
    orderId: order.id,
    name: greetName(sheet),
    placedDays,
    windowMin: delivery.minDays,
    windowMax: delivery.maxDays,
    workingDays: delivery.workingDays,
  };

  if (order.status === "delivered" || order.deliveredAt) {
    const deliveredAt = order.deliveredAt ?? order.shipment?.lastUpdate ?? order.placedAt;
    const deliveredDays = daysBetween(deliveredAt, today);
    facts.push({ label: "Delivered", value: `${fmtDate(deliveredAt)} — ${plural(deliveredDays, "day", "days")} ago`, source: "orders", tone: "ok" });
    if (signals.reportsMissing) {
      facts.push({ label: "Customer says", value: "Can't find the parcel", source: "customer", tone: "bad" });
      return {
        rule: "R5",
        brief: brief("escalate_missing_parcel", "escalate", "Missing parcel → courier check", {
          ...base,
          deliveredDays,
          slaHours: OPS.urgentSlaHours,
        }),
        summary: `Records say order #${order.id} was delivered ${plural(deliveredDays, "day", "days")} ago, but the customer can't find it. A disputed delivery isn't something the agent can settle, so rule R5 opens a courier check and hands it to staff.`,
        facts,
        actions: [{ kind: "carrier_trace", label: "Courier delivery check opened", detail: `DLV-${order.id} with ${order.shipment?.carrier ?? "courier"}` }],
        handoff: handoff("urgent", `Order #${order.id} (${itemsLabel(order)}) shows delivered ${deliveredDays} days ago; the customer says they can't find it. Check proof of delivery with ${order.shipment?.carrier ?? "the courier"}.`),
      };
    }
    return {
      rule: "R6",
      brief: brief("order_delivered", "resolve", "Delivery confirmed", { ...base, deliveredDays }),
      summary: `Records show order #${order.id} was delivered ${plural(deliveredDays, "day", "days")} ago. Rule R6: a factual status answer.`,
      facts,
    };
  }
  if (order.status === "cancelled" || order.status === "returned") {
    return {
      rule: "R5",
      brief: brief("escalate_review", "escalate", `${order.status === "cancelled" ? "Cancelled" : "Returned"} order → staff`, { slaHours: OPS.standardSlaHours }),
      summary: `Order #${order.id} is ${order.status}; the policy has no automated answer for that. Rule R5: hand to staff.`,
      facts,
      handoff: handoff("normal", `Customer asks about ${order.status} order #${order.id}.`),
    };
  }
  const tracking = order.shipment?.tracking;
  if (tracking === "failed_delivery" || tracking === "returned_to_sender") {
    facts.push({ label: "Courier status", value: tracking.replaceAll("_", " "), source: "orders", tone: "bad" });
    return {
      rule: "R5",
      brief: brief("escalate_review", "escalate", "Courier problem → staff", { slaHours: OPS.urgentSlaHours }),
      summary: `The courier reports “${tracking.replaceAll("_", " ")}” for order #${order.id}. Re-delivery or a refund is a staff decision. Rule R5: escalate.`,
      facts,
      handoff: handoff("urgent", `Order #${order.id} (${itemsLabel(order)}): ${order.shipment!.carrier} reports ${tracking.replaceAll("_", " ")}. Arrange re-delivery with the customer.`),
    };
  }

  const window = expectedWindow(order, sheet)!;
  facts.push({
    label: "Expected delivery",
    value: `${fmtDate(window.from)} – ${fmtDate(window.by)}${window.source === "computed" ? ` (order date + ${delivery.minDays}–${delivery.maxDays}${delivery.workingDays ? " working" : ""} days)` : ""}`,
    source: window.source,
  });
  const daysLate = daysBetween(window.by, today);
  const dates = { expectedFrom: isoDay(window.from), expectedBy: isoDay(window.by) };

  if (daysLate > 0) {
    facts.push({ label: "Days late", value: `${daysLate} (today vs. expected by ${fmtDate(window.by)})`, source: "computed", tone: "bad" });
    if (order.shipment) {
      facts.push({
        label: "Last courier update",
        value: `${order.shipment.tracking.replaceAll("_", " ")} · ${fmtDate(order.shipment.lastUpdate)}`,
        source: "orders",
      });
    }
    if (!order.shipment || daysLate > OPS.lateHandoffDays) {
      const why = !order.shipment
        ? `hasn't shipped yet although it was due by ${fmtDate(window.by)}`
        : `is ${daysLate} days past its expected date, beyond the ${OPS.lateHandoffDays}-day point where a person takes over`;
      return {
        rule: "R5",
        brief: brief("escalate_policy_limit", "escalate", order.shipment ? "Possible lost parcel → staff" : "Not shipped on time → staff", {
          ...base,
          ...dates,
          daysLate,
          slaHours: OPS.urgentSlaHours,
        }),
        summary: `Order #${order.id} ${why}. Rule R5: escalate.`,
        facts,
        handoff: handoff("urgent", `Order #${order.id} (${itemsLabel(order)}) ${why}. Decide refund, replacement or re-dispatch with the customer.`),
      };
    }
    const traceId = `TRC-${order.id}`;
    return {
      rule: "R6",
      brief: brief("order_late", "resolve", "Carrier trace opened", {
        ...base,
        ...dates,
        daysLate,
        carrier: order.shipment.carrier,
        lastUpdate: isoDay(order.shipment.lastUpdate),
        traceId,
      }),
      summary: `Order #${order.id} was due by ${fmtDate(window.by)} (${delivery.text.replace(/\.$/, "")}) and is ${plural(daysLate, "day", "days")} late. That is within the ${OPS.lateHandoffDays}-day limit, so the agent answers directly and opens a carrier trace.`,
      facts,
      actions: [{ kind: "carrier_trace", label: "Carrier trace opened", detail: `${traceId} with ${order.shipment.carrier}` }],
    };
  }

  facts.push({ label: "On schedule", value: `Yes — expected by ${fmtDate(window.by)}`, source: "computed", tone: "ok" });
  return {
    rule: "R6",
    brief: brief("order_on_time", "resolve", "On schedule", {
      ...base,
      ...dates,
      shipped: Boolean(order.shipment),
      carrier: order.shipment?.carrier,
    }),
    summary: `Order #${order.id} is expected by ${fmtDate(window.by)}, which hasn't passed. Rule R6: a factual status answer.`,
    facts,
  };
}

function warrantyFollowUp(sheet: FactSheet): { warrantyKind?: "human_staff" | "months"; warrantyMonths?: number } {
  const w = sheet.policies.warranty;
  if (!w) return {};
  return w.kind === "months" ? { warrantyKind: "months", warrantyMonths: w.months } : { warrantyKind: "human_staff" };
}

function returnPath(sheet: FactSheet, signals: Signals, sender: Sender): PathResult {
  const policy = sheet.policies.returns;
  if (!policy) return unreadablePolicy("returns", sender);
  const { windowDays, unopenedOnly } = policy;
  const order = sheet.order?.deliveredAt ? sheet.order : undefined;
  const item = order ? focusItem(order, signals.product) : undefined;
  const facts: Fact[] = [];
  let days: number | undefined;
  let daysSource: "record" | "customer" | undefined;

  if (order) {
    days = daysBetween(order.deliveredAt!, sheet.today);
    daysSource = "record";
    facts.push(orderFact(order));
    if (sheet.orderMatch !== "by_id") {
      facts.push({ label: "Matched by", value: "Sender's customer record + product mentioned", source: "computed" });
    }
    facts.push({ label: "Delivered", value: `${fmtDate(order.deliveredAt!)} — ${plural(days, "day", "days")} ago`, source: "orders" });
    if (signals.statedDays !== undefined && signals.statedDays !== days) {
      facts.push({ label: "Customer says", value: `${signals.statedDays} days (record wins)`, source: "customer" });
    }
  } else if (signals.statedDays !== undefined) {
    days = signals.statedDays;
    daysSource = "customer";
    facts.push({ label: "Days since delivery", value: `${days} (customer's own statement — no delivered order found)`, source: "customer" });
  }
  facts.push({ label: "Returns policy", value: policy.text, source: "policy" });
  if (item) {
    facts.push({ label: "Item opened (record)", value: item.opened ? `Yes — ${item.name}` : `No — ${item.name}`, source: "orders", tone: item.opened ? "bad" : "neutral" });
  }
  facts.push({
    label: "Box opened (customer)",
    value: signals.boxOpened === null ? "Not stated" : signals.boxOpened ? "Yes" : "No",
    source: "customer",
    tone: signals.boxOpened ? "bad" : "neutral",
  });

  // Anything that counts against the customer counts: the record or their own word.
  const opened = Boolean(item?.opened) || signals.boxOpened === true;
  const failures: string[] = [];
  if (days !== undefined && days > windowDays) failures.push("window");
  if (unopenedOnly && opened) failures.push("opened");

  const product = item?.category ?? signals.product;
  const common = { name: greetName(sheet), orderId: order?.id, product, days, daysSource, returnWindow: windowDays, unopenedOnly, ...warrantyFollowUp(sheet) };

  if (failures.length) {
    facts.push({
      label: "Return eligible",
      value: `No — ${failures.map((f) => (f === "window" ? `${days! - windowDays} days past the window` : "item opened")).join(" and ")}`,
      source: "computed",
      tone: "bad",
    });
    return {
      rule: "R6",
      brief: brief("return_declined", "resolve", "Declined per policy", { ...common, reasons: failures }),
      summary: `${daysSource === "record" ? `Delivered ${days} days ago per the shipment record` : `Customer says ${days} days`} vs. a ${windowDays}-day window${failures.includes("opened") ? `, and the item is opened (${item?.opened ? "per the order record" : "per the customer"})` : ""} — ${failures.length === 2 ? "both return conditions fail" : "a return condition fails"}. A “no” is fully supported by facts that only count against the customer, so the agent answers it directly.`,
      facts,
    };
  }

  const sealedKnown = item ? !opened : signals.boxOpened === false;
  if (days !== undefined && sealedKnown) {
    // A "yes" needs verified records, not just the customer's word.
    if (!order || !sheet.identity?.verified) {
      return {
        rule: "R4",
        brief: brief("need_order_number", "request_verification", "Order needed to approve", {}),
        summary: "The customer's own statements would qualify for a return, but an approval needs the order record and a verified buyer. Rule R4: ask for the order before saying yes.",
        facts,
      };
    }
    facts.push({ label: "Return eligible", value: `Yes — ${windowDays - days} days left, unopened per record`, source: "computed", tone: "ok" });
    return {
      rule: "R6",
      brief: brief("return_eligible", "resolve", "Return eligible", common),
      summary: `Order #${order.id} was delivered ${days} days ago (within ${windowDays}), the record shows the item unopened, and the customer is the verified buyer. Rule R6: confirm eligibility.`,
      facts,
    };
  }

  return {
    rule: "R6",
    brief: brief("return_info", "resolve", "Policy explained", common),
    summary: "Not enough detail to rule on eligibility, but the return policy itself answers the question. Rule R6: explain the policy and ask for the missing detail.",
    facts,
  };
}

function faultPath(sheet: FactSheet, signals: Signals, sender: Sender): PathResult {
  const warranty = sheet.policies.warranty;
  if (!warranty) return unreadablePolicy("warranty", sender);
  const order = sheet.order && sheet.identity?.verified ? sheet.order : undefined;
  const item = order ? focusItem(order, signals.product) : undefined;
  const facts: Fact[] = order ? [orderFact(order)] : [];
  facts.push({ label: "Warranty policy", value: warranty.text, source: "policy" });

  if (warranty.kind === "human_staff") {
    return {
      rule: "R5",
      brief: brief("warranty_handoff", "escalate", "Defective item → staff", {
        name: greetName(sheet),
        orderId: order?.id,
        product: item?.category ?? signals.product,
        slaHours: OPS.standardSlaHours,
      }),
      summary: `The customer reports a faulty product. The warranty policy says “${warranty.text}” Rule R5: hand to staff.`,
      facts,
      handoff: handoff(
        "normal",
        order
          ? `Defective item reported on order #${order.id} (${item?.name ?? itemsLabel(order)}, delivered ${order.deliveredAt ? `${daysBetween(order.deliveredAt, sheet.today)} days ago` : "not yet"}).`
          : `${sender.displayName} (${sender.channel} ${sender.handle}) reports a defective item; no verified order yet.`,
      ),
    };
  }

  const missing = needOrder(sheet, "warranty");
  if (missing) return missing;
  const o = sheet.order!;
  const since = daysBetween(o.deliveredAt ?? o.placedAt, sheet.today);
  const monthsLeft = warranty.months - Math.floor(since / 30);
  facts.push({ label: "Warranty left", value: `${warranty.months} months — ${monthsLeft} left`, source: "computed", tone: monthsLeft > 0 ? "ok" : "bad" });
  if (monthsLeft <= 0) {
    return {
      rule: "R5",
      brief: brief("escalate_review", "escalate", "Out of warranty → staff", { slaHours: OPS.standardSlaHours }),
      summary: `Order #${o.id} is outside the ${warranty.months}-month warranty; paid repairs aren't covered by policy. Rule R5: staff decide.`,
      facts,
      handoff: handoff("normal", `Out-of-warranty fault on #${o.id} (${itemsLabel(o)}).`),
    };
  }
  return {
    rule: "R6",
    brief: brief("warranty_repair", "resolve", "Warranty repair explained", {
      name: greetName(sheet),
      orderId: o.id,
      product: focusItem(o, signals.product)?.category,
      monthsLeft,
      warrantyMonths: warranty.months,
    }),
    summary: `Order #${o.id} is within warranty (${monthsLeft} months left). Rule R6: explain the repair process.`,
    facts,
  };
}

function personalDataPath(sheet: FactSheet, signals: Signals, sender: Sender): PathResult {
  const fields = signals.personalData.fields;
  const fieldList = fields.map((f) => PII_LABEL[f]).join(", ");
  if (!sheet.order) {
    const missing = needOrder(sheet, "requester");
    return { ...missing!, withheld: [`Any ${fieldList} (no order to check against)`] };
  }
  const order = sheet.order;
  const facts: Fact[] = [
    { label: `Order #${order.id}`, value: "Exists in records", source: "orders" },
    {
      label: "Buyer contact on file",
      value: [order.buyer.phone && maskPhone(order.buyer.phone), order.buyer.email && maskEmail(order.buyer.email), order.buyer.instagram].filter(Boolean).join(" · "),
      source: "orders",
    },
    { label: "Requester", value: `${sender.channel} ${sender.handle}${sender.customerId ? "" : " (not in customer records)"}`, source: "channel" },
    identityFact(sheet, sender),
  ];
  const withheldText = fields.map((f) => `${PII_LABEL[f]} on order #${order.id}`);

  if (sheet.identity?.verified) {
    const values = fields.map((f) => order.buyer[f] ?? "not on file");
    const disclose = values.filter((v) => v !== "not on file");
    return {
      rule: "R6",
      brief: brief(
        "pii_disclose",
        "resolve",
        "Shared with verified buyer",
        { name: firstName(order), orderId: order.id, fields, values },
        { disclose, withhold: allPii(order).filter((v) => !disclose.includes(v)) },
      ),
      summary: `The requester is the verified buyer of #${order.id} (${sheet.identity.method?.replaceAll("_", " ")}). Rule R3 is satisfied, so the requested ${fieldList} can be shared.`,
      facts,
      actions: [{ kind: "disclosure_log", label: "Disclosure logged", detail: `${fieldList} of #${order.id} → ${sender.channel} ${sender.handle}` }],
    };
  }

  const third = sheet.identity?.thirdParty;
  return {
    rule: "R3",
    brief: brief(
      third ? "pii_third_party" : "pii_unverified",
      "request_verification",
      `${fieldList[0].toUpperCase()}${fieldList.slice(1)} withheld`,
      { orderId: order.id },
      { withhold: allPii(order) },
    ),
    summary: third
      ? `The requester identifies as a third party (${signals.thirdParty.relation ? `“${signals.thirdParty.relation}”` : "acting for someone else"}) and ${sender.channel} ${sender.handle} isn't one of the buyer's contacts on #${order.id}. Rule R3: the ${fieldList} is withheld and only the buyer can unlock it.`
      : `The requester's contact doesn't match the buyer of #${order.id}. Rule R3: withhold the ${fieldList} and ask for verification.`,
    facts,
    withheld: withheldText,
    actions: [{ kind: "withheld", label: "Personal data withheld", detail: withheldText.join(", ") }],
  };
}

/** Status, returns and warranty of an order go only to its buyer. */
function orderOwnerGate(sheet: FactSheet, signals: Signals, sender: Sender): PathResult | undefined {
  const order = sheet.order;
  if (!order || sheet.identity?.verified) return undefined;
  const third = sheet.identity?.thirdParty;
  return {
    rule: "R3",
    brief: brief(third ? "pii_third_party" : "order_unverified", "request_verification", "Order details withheld", { orderId: order.id }, { withhold: allPii(order) }),
    summary: third
      ? `The requester says they are writing for someone else (${signals.thirdParty.relation ? `“${signals.thirdParty.relation}”` : "a third party"}), and order #${order.id} isn't theirs. Rule R3: its details go only to the buyer.`
      : `Order #${order.id} belongs to another customer — ${sender.channel} ${sender.handle} isn't one of the buyer's contacts and no matching details were given. Rule R3: its status and details are withheld until the buyer is verified.`,
    facts: [{ label: `Order #${order.id}`, value: "Exists in records", source: "orders" }, identityFact(sheet, sender)],
    withheld: [`Status and details of order #${order.id}`],
    actions: [{ kind: "withheld", label: "Order details withheld", detail: `#${order.id} requested by ${sender.channel} ${sender.handle}` }],
  };
}

function policyQuotePath(sheet: FactSheet, topic: string): PathResult {
  const text = policyText(sheet.policies, topic)!;
  const info = topicInfo(topic);
  return {
    rule: "R6",
    brief: brief("policy_quote", "resolve", `Policy: ${info?.label ?? topic}`, { topic, text }),
    summary: `The policies table has a “${topic}” row. Rule R6: answer with its exact wording and nothing more.`,
    facts: [{ label: `Policy · ${topic}`, value: text, source: "policy" }],
  };
}

// ---- entry point -----------------------------------------------------------

export function decide(signals: Signals, sheet: FactSheet, sender: Sender): RulesOutcome {
  const checks: RuleCheck[] = [];
  const book = sheet.policies;
  const facts: Fact[] = [
    {
      label: "Channel identity",
      value: `${sender.channel[0].toUpperCase()}${sender.channel.slice(1)} · ${sender.handle}${sender.customerId ? ` → customer #${sender.customerId}` : " (not in customer records)"}`,
      source: "channel",
    },
  ];
  const { history } = sheet;
  if (sheet.orderMatch === "from_thread" && sheet.order) {
    facts.push({ label: "Order context", value: `#${sheet.order.id}, mentioned earlier in this chat`, source: "channel" });
  }

  // R1 — frustration or repeat contact
  const repeatFromLog = history.unanswered >= OPS.repeatThreshold;
  const repeatFromSession = history.sessionUnresolved >= 2;
  const r1Reasons = [
    ...(signals.frustration.hit ? signals.frustration.evidence : []),
    ...(signals.repeat.hit ? signals.repeat.evidence : []),
    ...(repeatFromLog ? [`Contact log: ${history.unanswered} unanswered messages in the last ${OPS.repeatWindowDays} days`] : []),
    ...(repeatFromSession ? [`${history.sessionUnresolved} unresolved messages earlier in this chat`] : []),
  ];
  if (history.log.length) {
    facts.push({
      label: `Earlier contacts (${OPS.repeatWindowDays} days)`,
      value: history.log
        .map((e) => `${e.daysAgo === 0 ? "today" : `${plural(e.daysAgo, "day", "days")} ago`} via ${e.channel}${e.answered ? "" : " — unanswered"}`)
        .join(" · "),
      source: "contact_log",
      tone: history.unanswered ? "bad" : "neutral",
    });
  }
  const r1 = r1Reasons.length > 0;
  checks.push({
    id: "R1",
    title: RULES.R1.title,
    status: r1 ? "fired" : "passed",
    decision: r1 ? "escalate" : undefined,
    detail: r1 ? r1Reasons.join(" · ") : "No anger markers, no repeat-contact phrases, contact log clean",
  });

  // R2 — policy coverage, straight from the policies table
  const intent = signals.intent.value;
  const needed = requiredTopic(intent, signals.topic.topicId);
  const r2 = signals.policyGap.hit || (needed !== null && !covers(book, needed)) || (intent === "other" && !signals.topic.hit);
  const gapTopic = r2 ? topicInfo(signals.policyGap.topicId ?? needed ?? undefined) : undefined;
  checks.push({
    id: "R2",
    title: RULES.R2.title,
    status: r2 ? "fired" : "passed",
    decision: r2 ? "escalate" : undefined,
    detail: r2
      ? gapTopic
        ? `“${gapTopic.label}” — no row in the policies table`
        : "The request doesn't map to any written policy"
      : needed
        ? `Covered by the “${needed}” policy: ${policyText(book, needed)}`
        : "Conversation — no policy needed",
  });
  if (r2) {
    facts.push({
      label: "Policy coverage",
      value: gapTopic ? `None — no written policy on ${gapTopic.label.toLowerCase()}` : "None — topic not in the policy book",
      source: "policy",
      tone: "bad",
    });
  }

  // R3 — personal data (evaluated inside the PII path, reported here)
  const wantsPii = signals.personalData.hit;
  const ownerGated = ["order_status", "return_request", "product_fault"].includes(intent) && Boolean(sheet.order);

  let path: PathResult;
  if (r1) {
    const order = sheet.order;
    const verified = sheet.identity?.verified;
    const who = verified && order ? `${order.buyer.name} (${sender.channel} ${sender.handle})` : `${sender.displayName} (${sender.channel} ${sender.handle})`;
    const prior = history.log.map((e) => `${e.daysAgo}d ago via ${e.channel}${e.answered ? "" : " (unanswered)"}: ${e.summary.length > 140 ? `${e.summary.slice(0, 137)}…` : e.summary}`);
    path = {
      rule: "R1",
      brief: brief("escalate_upset", "escalate", "Priority handoff — no auto-answer", {
        name: greetName(sheet),
        slaHours: OPS.urgentSlaHours,
      }),
      summary: `${r1Reasons.join("; ")}. Rule R1 sends this straight to a person — the agent does not attempt an answer, it only confirms the handoff.`,
      facts: order && verified ? [orderFact(order)] : [],
      handoff: handoff(
        "urgent",
        [
          `${who} is upset or has contacted us before.`,
          order && verified
            ? `Order #${order.id}: ${itemsLabel(order)}, ${order.deliveredAt ? `delivered ${daysBetween(order.deliveredAt, sheet.today)} days ago` : STATUS_LABEL[order.status]}.`
            : "",
          prior.length ? `Earlier: ${prior.join(" | ")}.` : "",
          "Call or reply personally — do not send another template.",
        ]
          .filter(Boolean)
          .join(" "),
      ),
    };
  } else if (r2) {
    path = {
      rule: "R2",
      brief: brief(gapTopic ? "escalate_policy_gap" : "escalate_no_policy", "escalate", gapTopic ? `No policy: ${gapTopic.label.toLowerCase()}` : "Not covered by policy", {
        topicId: gapTopic?.id,
        slaHours: OPS.standardSlaHours,
      }),
      summary: gapTopic
        ? `The customer asks about ${gapTopic.en}. The policies table has no row for it, so any answer would be a guess. Rule R2: a person answers.`
        : "The message doesn't match any topic in the policies table. Rule R2: a person answers rather than the agent guessing.",
      facts: [],
      handoff: handoff(
        "normal",
        gapTopic
          ? `${sender.displayName} (${sender.channel} ${sender.handle}) asks about ${gapTopic.en}. No written policy exists — please answer and consider adding one.`
          : `${sender.displayName} (${sender.channel} ${sender.handle}) asked something outside the policy book.`,
        "Support team",
      ),
    };
  } else if (wantsPii) {
    path = personalDataPath(sheet, signals, sender);
  } else if (ownerGated && orderOwnerGate(sheet, signals, sender)) {
    path = orderOwnerGate(sheet, signals, sender)!;
  } else {
    switch (intent) {
      case "order_status":
        path = orderStatusPath(sheet, signals, sender);
        break;
      case "return_request":
        path = returnPath(sheet, signals, sender);
        break;
      case "product_fault":
        path = faultPath(sheet, signals, sender);
        break;
      case "delivery_info": {
        const d = book.delivery;
        path = d
          ? {
              rule: "R6",
              brief: brief("delivery_info", "resolve", "Delivery info", { windowMin: d.minDays, windowMax: d.maxDays, workingDays: d.workingDays }),
              summary: "Delivery times are in the policies table. Rule R6: answer directly.",
              facts: [{ label: "Delivery policy", value: d.text, source: "policy" }],
            }
          : unreadablePolicy("delivery", sender);
        break;
      }
      case "small_talk":
        path = {
          rule: "R6",
          brief: brief("conversation", "resolve", "Conversation", { variant: signals.smallTalk ?? "greeting", topics: book.topics }),
          summary:
            "Small talk with no concrete request. The agent replies conversationally and offers what it can help with. It states no facts and makes no promises, so there is nothing to verify.",
          facts: [],
        };
        break;
      default:
        // A covered topic without a computed path (store info, payments, installments… when the
        // policies table has a row for it): quote the policy text verbatim.
        path = policyQuotePath(sheet, needed!);
    }
  }

  // Report R3–R6 in the checklist.
  const needsOwner = wantsPii || ownerGated;
  const r3Status: RuleCheck["status"] = !needsOwner ? "not_applicable" : path.rule === "R3" ? "fired" : r1 || r2 ? "not_applicable" : "passed";
  checks.push({
    id: "R3",
    title: RULES.R3.title,
    status: r3Status,
    decision: r3Status === "fired" ? "request_verification" : undefined,
    detail: !needsOwner
      ? "No order details or personal data requested"
      : r3Status === "fired"
        ? "Requester is not the verified buyer → order details withheld"
        : r3Status === "passed"
          ? `Requester verified as the buyer of #${sheet.order?.id}`
          : "Order details requested — withheld (already escalated)",
  });
  const r4 = path.rule === "R4";
  checks.push({
    id: "R4",
    title: RULES.R4.title,
    status: r4 ? "fired" : r1 || r2 || r3Status === "fired" ? "not_applicable" : "passed",
    decision: r4 ? "request_verification" : undefined,
    detail: r4 ? path.summary : sheet.order ? `Order #${sheet.order.id} found in records` : "No record needed for this question",
  });
  const r5 = path.rule === "R5";
  checks.push({
    id: "R5",
    title: RULES.R5.title,
    status: r5 ? "fired" : path.rule === "R6" ? "passed" : "not_applicable",
    decision: r5 ? "escalate" : undefined,
    detail: r5 ? path.summary : "Within the limits the policy lets the agent handle",
  });
  checks.push({
    id: "R6",
    title: RULES.R6.title,
    status: path.rule === "R6" ? "fired" : "not_applicable",
    decision: path.rule === "R6" ? "resolve" : undefined,
    detail: path.rule === "R6" ? path.brief.outcome : "A stricter rule already decided",
  });

  // Strictest fired rule wins (R1..R5 are ordered so this is also the path rule).
  const decision = checks
    .filter((c) => c.status === "fired" && c.decision)
    .map((c) => c.decision!)
    .reduce<Decision>((acc, d) => (STRICTNESS[d] > STRICTNESS[acc] ? d : acc), "resolve");

  const withheld = [...(path.withheld ?? [])];
  if (wantsPii && path.rule !== "R3" && path.rule !== "R6" && sheet.order) {
    withheld.push(...signals.personalData.fields.map((f) => `${PII_LABEL[f]} on order #${sheet.order!.id}`));
  }

  const outcomeBrief: ReplyBrief = {
    ...path.brief,
    decision,
    withhold: [...new Set([...path.brief.withhold, ...allPii(sheet.order).filter((v) => !path.brief.disclose.includes(v))])],
  };

  return {
    decision,
    fired: path.rule,
    checks,
    brief: outcomeBrief,
    facts: [...facts, ...path.facts],
    actions: [
      ...(path.actions ?? []),
      ...(path.handoff
        ? [
            {
              kind: "handoff" as const,
              label: `Handed to ${path.handoff.queue}`,
              detail: `Priority ${path.handoff.priority} · reply due within ${path.handoff.slaHours}h`,
            },
          ]
        : []),
    ],
    withheld,
    handoff: path.handoff,
    summary: path.summary,
  };
}
