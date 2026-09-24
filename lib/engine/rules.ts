import type { Order } from "@/lib/data/orders";
import { POLICY, SHOP, UNCOVERED_TOPICS } from "@/lib/data/shop";
import type { FactSheet } from "./facts";
import { daysBetween, maskEmail, maskPhone, plural } from "./text";
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
    description: "If the shop's policy doesn't cover the question, the agent never guesses.",
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
    description: "Cases the policy explicitly hands to staff (e.g. a parcel more than 10 days old).",
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

const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const firstName = (o: Order) => o.buyer.name.split(" ")[0];
const PII_LABEL = { address: "delivery address", phone: "phone number", email: "email" } as const;
const POLICY_FOR_INTENT: Record<Signals["intent"]["value"], string> = {
  order_status: "delivery",
  return_request: "returns",
  product_fault: "warranty",
  personal_data_request: "privacy",
  store_info: "store & hours",
  delivery_info: "delivery",
  payment_methods: "payment methods",
  financing: "—",
  small_talk: "conversation",
  other: "—",
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
  return order ? [order.buyer.address, order.buyer.phone, order.buyer.email] : [];
}

function orderFact(order: Order): Fact {
  const status = { processing: "being prepared", in_transit: "in transit", delivered: "delivered", cancelled: "cancelled" }[
    order.status
  ];
  return { label: `Order #${order.id}`, value: `${order.item.name} · ${status}`, source: "orders" };
}

function identityFact(sheet: FactSheet, sender: Sender): Fact {
  const id = sheet.identity;
  if (!id || !sheet.order) return { label: "Requester = buyer?", value: "No order to compare against", source: "computed" };
  const buyer = sheet.order.buyer;
  if (id.verified) {
    const how = {
      linked_account: `${sender.channel} account is linked to the buyer's customer profile`,
      channel_phone: `Viber number matches buyer phone (${maskPhone(buyer.phone)})`,
      channel_email: `Sender address matches buyer email (${maskEmail(buyer.email)})`,
      stated_email_and_phone: "Stated email and phone both match the buyer record",
    }[id.method!];
    return { label: "Requester = buyer?", value: `Yes — ${how}`, source: "computed", tone: "ok" };
  }
  const reasons: string[] = [];
  if (id.thirdParty) reasons.push("says they are writing for someone else");
  if (!id.channelMatch) {
    reasons.push(
      sender.email || sender.phone
        ? `${sender.channel} contact isn't the buyer's`
        : `${sender.channel} account has no verified phone or email`,
    );
  }
  if (id.statedEmailMatch !== id.statedPhoneMatch) reasons.push("only one of email/phone stated");
  return { label: "Requester = buyer?", value: `No — ${reasons.join("; ")}`, source: "computed", tone: "bad" };
}

function greetName(sheet: FactSheet): string | undefined {
  return sheet.order && sheet.identity?.verified ? firstName(sheet.order) : undefined;
}

// ---- paths per intent --------------------------------------------------------

function needOrder(sheet: FactSheet, forWhat: string): PathResult | undefined {
  if (sheet.orderMatch === "id_not_found") {
    return {
      rule: "R4",
      brief: brief("order_not_found", "request_verification", "Order number not found", { orderId: sheet.requestedOrderId }),
      summary: `Order #${sheet.requestedOrderId} doesn't exist in the order records, so nothing can be confirmed. Rule R4: ask the customer to double-check instead of guessing.`,
      facts: [{ label: `Order #${sheet.requestedOrderId}`, value: "Not found in records", source: "orders", tone: "bad" }],
    };
  }
  if (!sheet.order) {
    return {
      rule: "R4",
      brief: brief("need_order_number", "request_verification", "Order number requested"),
      summary: `No order number was given and the sender's contact isn't linked to any order, so the ${forWhat} can't be checked. Rule R4: ask for the order number.`,
      facts: [{ label: "Order", value: "None referenced, none linked to this sender", source: "orders", tone: "warn" }],
    };
  }
  return undefined;
}

function orderStatusPath(sheet: FactSheet, signals: Signals): PathResult {
  const missing = needOrder(sheet, "delivery status");
  if (missing) return missing;
  const order = sheet.order!;
  const { windowMinDays, windowMaxDays, humanAfterDays, traceUpdateHours } = POLICY.delivery;
  const days = daysBetween(order.placedAt, sheet.now);
  const facts: Fact[] = [
    orderFact(order),
    { label: "Placed", value: `${fmtDate(order.placedAt)} — ${plural(days, "day", "days")} ago`, source: "computed" },
    { label: "Delivery window", value: `${windowMinDays}–${windowMaxDays} days`, source: "policy" },
  ];
  if (signals.statedDays !== undefined) {
    facts.push({
      label: "Customer says",
      value: `${plural(signals.statedDays, "day", "days")}${signals.statedDays === days ? " (matches record)" : ` (record says ${days})`}`,
      source: "customer",
      tone: "neutral",
    });
  }
  const base = { orderId: order.id, name: greetName(sheet), days, windowMin: windowMinDays, windowMax: windowMaxDays };

  if (order.status === "delivered") {
    const deliveredDays = daysBetween(order.deliveredAt!, sheet.now);
    facts.push({ label: "Delivered", value: `${fmtDate(order.deliveredAt!)} — ${plural(deliveredDays, "day", "days")} ago`, source: "orders", tone: "ok" });
    if (signals.reportsMissing) {
      facts.push({ label: "Customer says", value: "Can't find the parcel", source: "customer", tone: "bad" });
      return {
        rule: "R5",
        brief: brief("escalate_missing_parcel", "escalate", "Missing parcel → courier check", {
          ...base,
          deliveredDays,
          slaHours: POLICY.escalation.urgentSlaHours,
        }),
        summary: `Records say order #${order.id} was delivered ${plural(deliveredDays, "day", "days")} ago, but the customer can't find it. A disputed delivery isn't something the agent can settle, so rule R5 opens a courier check and hands it to staff.`,
        facts,
        actions: [{ kind: "carrier_trace", label: "Courier delivery check opened", detail: `DLV-${order.id} with ${order.carrier ?? "courier"}` }],
        handoff: handoff("urgent", `Order #${order.id} (${order.item.name}) shows delivered ${deliveredDays} days ago; the customer says they can't find it. Check proof of delivery with the courier.`),
      };
    }
    return {
      rule: "R6",
      brief: brief("order_delivered", "resolve", "Delivery confirmed", { ...base, deliveredDays }),
      summary: `Records show order #${order.id} was delivered ${plural(deliveredDays, "day", "days")} ago. Rule R6: a factual status answer.`,
      facts,
    };
  }
  if (order.status === "cancelled") {
    return {
      rule: "R5",
      brief: brief("escalate_review", "escalate", "Cancelled order → staff", { slaHours: POLICY.escalation.standardSlaHours }),
      summary: `Order #${order.id} is cancelled; the policy has no automated answer for that. Rule R5: hand to staff.`,
      facts,
      handoff: handoff("normal", `Customer asks about cancelled order #${order.id}.`),
    };
  }

  const daysLate = days - windowMaxDays;
  if (days > humanAfterDays) {
    facts.push({ label: "Days past window", value: `${daysLate} — over the ${humanAfterDays}-day limit`, source: "computed", tone: "bad" });
    return {
      rule: "R5",
      brief: brief("escalate_policy_limit", "escalate", "Possible lost parcel → staff", {
        ...base,
        slaHours: POLICY.escalation.urgentSlaHours,
      }),
      summary: `Order #${order.id} was placed ${days} days ago — past the ${humanAfterDays}-day point where policy says a person decides between refund and replacement. Rule R5: escalate.`,
      facts,
      handoff: handoff(
        "urgent",
        `Order #${order.id} (${order.item.name}) is ${days} days old, last courier scan ${order.lastScan?.daysAgo ?? "?"} days ago. Policy: staff decide refund vs replacement.`,
      ),
    };
  }
  if (daysLate > 0) {
    const traceId = `TRC-${order.id}`;
    facts.push({ label: "Days past window", value: `${daysLate} (placed ${days} days ago vs. ${windowMaxDays}-day max)`, source: "computed", tone: "bad" });
    if (order.lastScan) {
      facts.push({
        label: "Last courier scan",
        value: `${order.lastScan.en}, ${plural(order.lastScan.daysAgo, "day", "days")} ago`,
        source: "orders",
      });
    }
    return {
      rule: "R6",
      brief: brief("order_late", "resolve", "Carrier trace opened", {
        ...base,
        daysLate,
        carrier: order.carrier,
        lastScanEn: order.lastScan?.en,
        lastScanSq: order.lastScan?.sq,
        lastScanDays: order.lastScan?.daysAgo,
        traceId,
        traceHours: traceUpdateHours,
        humanAfterDays,
      }),
      summary: `Order #${order.id} was placed ${days} days ago; the delivery window is ${windowMinDays}–${windowMaxDays} days, so it is ${plural(daysLate, "day", "days")} late. That is inside the late-delivery policy (under ${humanAfterDays} days), so the agent answers directly and opens a carrier trace.`,
      facts,
      actions: [
        {
          kind: "carrier_trace",
          label: "Carrier trace opened",
          detail: `${traceId} with ${order.carrier} · update promised within ${traceUpdateHours}h`,
        },
      ],
    };
  }
  const remaining = Math.max(windowMaxDays - days, 1);
  facts.push({ label: "Within window", value: `Yes — up to ${plural(remaining, "day", "days")} left`, source: "computed", tone: "ok" });
  return {
    rule: "R6",
    brief: brief("order_on_time", "resolve", "On schedule", {
      ...base,
      remaining,
      status: order.status,
      carrier: order.carrier,
    }),
    summary: `Order #${order.id} is ${plural(days, "day", "days")} old, inside the ${windowMinDays}–${windowMaxDays} day window. Rule R6: a factual status answer.`,
    facts,
  };
}

function returnPath(sheet: FactSheet, signals: Signals): PathResult {
  const { windowDays, refundBusinessDays } = POLICY.returns;
  const order = sheet.order?.status === "delivered" ? sheet.order : undefined;
  const facts: Fact[] = [];
  let days: number | undefined;
  let daysSource: "record" | "customer" | undefined;

  if (order) {
    days = daysBetween(order.deliveredAt!, sheet.now);
    daysSource = "record";
    facts.push(orderFact(order));
    if (sheet.orderMatch !== "by_id") {
      facts.push({ label: "Matched by", value: "Sender's verified contact + product mentioned", source: "computed" });
    }
    facts.push({ label: "Delivered", value: `${fmtDate(order.deliveredAt!)} — ${plural(days, "day", "days")} ago`, source: "computed" });
    if (signals.statedDays !== undefined && signals.statedDays !== days) {
      facts.push({ label: "Customer says", value: `${signals.statedDays} days (record wins)`, source: "customer" });
    }
  } else if (signals.statedDays !== undefined) {
    days = signals.statedDays;
    daysSource = "customer";
    facts.push({ label: "Days since delivery", value: `${days} (customer's own statement — no order found)`, source: "customer" });
  }
  facts.push({ label: "Return window", value: `${windowDays} days, unopened items only`, source: "policy" });
  facts.push({
    label: "Box opened",
    value: signals.boxOpened === null ? "Not stated" : signals.boxOpened ? "Yes (customer's statement)" : "No (customer's statement)",
    source: "customer",
    tone: signals.boxOpened ? "bad" : "neutral",
  });

  const failures: string[] = [];
  if (days !== undefined && days > windowDays) failures.push("window");
  if (signals.boxOpened === true) failures.push("opened");

  const product = order?.item.category ?? signals.product;
  const warrantyMonthsLeft = order ? POLICY.warranty.months - Math.floor(days! / 30) : undefined;
  const common = { name: greetName(sheet), orderId: order?.id, product, days, daysSource, returnWindow: windowDays };

  if (failures.length) {
    facts.push({
      label: "Return eligible",
      value: `No — ${failures.map((f) => (f === "window" ? `${days! - windowDays} days past the window` : "box opened")).join(" and ")}`,
      source: "computed",
      tone: "bad",
    });
    if (warrantyMonthsLeft !== undefined) {
      facts.push({ label: "Warranty", value: `Active — ${warrantyMonthsLeft} of ${POLICY.warranty.months} months left`, source: "computed", tone: "ok" });
    }
    return {
      rule: "R6",
      brief: brief("return_declined", "resolve", "Declined per policy", {
        ...common,
        reasons: failures,
        warrantyMonths: POLICY.warranty.months,
        warrantyActive: warrantyMonthsLeft === undefined ? undefined : warrantyMonthsLeft > 0,
      }),
      summary: `${daysSource === "record" ? `Delivered ${days} days ago per the order record` : `Customer says ${days} days`} vs. a ${windowDays}-day window${failures.includes("opened") ? ", and the customer says the box is open" : ""} — ${failures.length === 2 ? "both return conditions fail" : "a return condition fails"}. A “no” is fully supported by facts that only count against the customer, so the agent answers it directly.`,
      facts,
    };
  }

  if (days !== undefined && signals.boxOpened === false) {
    // A "yes" needs verified facts, not just the customer's word.
    if (!order || !sheet.identity?.verified) {
      return {
        rule: "R4",
        brief: brief("need_order_number", "request_verification", "Order needed to approve", {}),
        summary: "The customer's own statements would qualify for a return, but an approval needs the order record and a verified buyer. Rule R4: ask for the order before saying yes.",
        facts,
      };
    }
    facts.push({ label: "Return eligible", value: `Yes — ${windowDays - days} days left, sealed (to be checked in store)`, source: "computed", tone: "ok" });
    return {
      rule: "R6",
      brief: brief("return_eligible", "resolve", "Return approved (seal check)", {
        ...common,
        storeAddress: SHOP.address,
        refundDays: refundBusinessDays,
      }),
      summary: `Order #${order.id} was delivered ${days} days ago (within ${windowDays}) and the customer is the verified buyer. Rule R6: confirm the return, subject to the seal check.`,
      facts,
    };
  }

  return {
    rule: "R6",
    brief: brief("return_info", "resolve", "Policy explained", { ...common }),
    summary: "Not enough detail to rule on eligibility, but the return policy itself answers the question. Rule R6: explain the policy and ask for the missing detail.",
    facts,
  };
}

function faultPath(sheet: FactSheet): PathResult {
  const missing = needOrder(sheet, "warranty");
  if (missing) return missing;
  const order = sheet.order!;
  const since = daysBetween(order.deliveredAt ?? order.placedAt, sheet.now);
  const monthsLeft = POLICY.warranty.months - Math.floor(since / 30);
  const facts: Fact[] = [
    orderFact(order),
    { label: "Warranty", value: `${POLICY.warranty.months} months — ${monthsLeft} left`, source: "computed", tone: monthsLeft > 0 ? "ok" : "bad" },
  ];
  if (monthsLeft <= 0) {
    return {
      rule: "R5",
      brief: brief("escalate_review", "escalate", "Out of warranty → staff", { slaHours: POLICY.escalation.standardSlaHours }),
      summary: `Order #${order.id} is outside the ${POLICY.warranty.months}-month warranty; paid repairs aren't covered by policy. Rule R5: staff decide.`,
      facts,
      handoff: handoff("normal", `Out-of-warranty fault on #${order.id} (${order.item.name}).`),
    };
  }
  return {
    rule: "R6",
    brief: brief("warranty_repair", "resolve", "Warranty repair explained", {
      name: greetName(sheet),
      orderId: order.id,
      product: order.item.category,
      monthsLeft,
      warrantyMonths: POLICY.warranty.months,
      storeAddress: SHOP.address,
      diagnostics: POLICY.warranty.diagnostics,
    }),
    summary: `Order #${order.id} is within warranty (${monthsLeft} months left). Rule R6: explain the repair process.`,
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
    { label: "Buyer contact on file", value: `${maskPhone(order.buyer.phone)} · ${maskEmail(order.buyer.email)}`, source: "orders" },
    {
      label: "Requester",
      value: `${sender.channel} ${sender.handle}${sender.email || sender.phone ? "" : " (no verified phone/email)"}`,
      source: "channel",
    },
    identityFact(sheet, sender),
  ];
  const withheldText = fields.map((f) => `${PII_LABEL[f]} on order #${order.id}`);

  if (sheet.identity?.verified) {
    const values = fields.map((f) => order.buyer[f]);
    return {
      rule: "R6",
      brief: brief(
        "pii_disclose",
        "resolve",
        "Shared with verified buyer",
        { name: firstName(order), orderId: order.id, fields, values },
        { disclose: values, withhold: allPii(order).filter((v) => !values.includes(v)) },
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
      ? `The requester identifies as a third party (${signals.thirdParty.relation ? `“${signals.thirdParty.relation}”` : "acting for someone else"}) and their ${sender.channel} account isn't linked to the buyer's phone or email on #${order.id}. Rule R3: the ${fieldList} is withheld and only the buyer can unlock it.`
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
      : `Order #${order.id} belongs to another customer — ${sender.displayName}'s ${sender.channel} account isn't linked to it and no matching contact details were given. Rule R3: its status and details are withheld until the buyer is verified.`,
    facts: [
      { label: `Order #${order.id}`, value: "Exists in records", source: "orders" },
      identityFact(sheet, sender),
    ],
    withheld: [`Status and details of order #${order.id}`],
    actions: [{ kind: "withheld", label: "Order details withheld", detail: `#${order.id} requested by ${sender.channel} ${sender.handle}` }],
  };
}

function handoff(priority: Handoff["priority"], note: string, queue?: string): Handoff {
  return {
    priority,
    queue: queue ?? (priority === "urgent" ? "Senior support" : "Support team"),
    slaHours: priority === "urgent" ? POLICY.escalation.urgentSlaHours : POLICY.escalation.standardSlaHours,
    note,
  };
}

// ---- entry point -----------------------------------------------------------

export function decide(signals: Signals, sheet: FactSheet, sender: Sender): RulesOutcome {
  const checks: RuleCheck[] = [];
  const facts: Fact[] = [
    {
      label: "Channel identity",
      value: `${sender.channel[0].toUpperCase()}${sender.channel.slice(1)} · ${sender.handle}`,
      source: "channel",
    },
  ];
  const { history } = sheet;
  if (sheet.orderMatch === "from_thread" && sheet.order) {
    facts.push({ label: "Order context", value: `#${sheet.order.id}, mentioned earlier in this chat`, source: "channel" });
  }

  // R1 — frustration or repeat contact
  const repeatFromLog = history.unanswered14d >= 2;
  const repeatFromSession = history.sessionUnresolved >= 2;
  const r1Reasons = [
    ...(signals.frustration.hit ? signals.frustration.evidence : []),
    ...(signals.repeat.hit ? signals.repeat.evidence : []),
    ...(repeatFromLog ? [`Contact log: ${history.unanswered14d} unanswered messages in the last 14 days`] : []),
    ...(repeatFromSession ? [`${history.sessionUnresolved} unresolved messages earlier in this chat`] : []),
  ];
  if (history.log.length) {
    facts.push({
      label: "Earlier contacts (14 days)",
      value: history.log
        .map((e) => `${plural(e.daysAgo, "day", "days")} ago via ${e.channel}${e.answered ? "" : " — unanswered"}`)
        .join(" · "),
      source: "contact_log",
      tone: history.unanswered14d ? "bad" : "neutral",
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

  // R2 — policy coverage
  const topic = UNCOVERED_TOPICS.find((t) => t.id === signals.policyGap.topicId);
  const r2 = signals.policyGap.hit || signals.intent.value === "financing" || signals.intent.value === "other";
  checks.push({
    id: "R2",
    title: RULES.R2.title,
    status: r2 ? "fired" : "passed",
    decision: r2 ? "escalate" : undefined,
    detail: r2
      ? topic
        ? `“${topic.label}” — the shop has no written policy on this`
        : "The request doesn't map to any written policy"
      : `Covered by the ${POLICY_FOR_INTENT[signals.intent.value]} policy`,
  });
  if (r2) {
    facts.push({
      label: "Policy coverage",
      value: topic ? `None — no written policy on ${topic.label.toLowerCase()}` : "None — topic not in the policy book",
      source: "policy",
      tone: "bad",
    });
  }

  // R3 — personal data (evaluated inside the PII path, reported here)
  const wantsPii = signals.personalData.hit;
  const ownerGated = ["order_status", "return_request", "product_fault"].includes(signals.intent.value) && Boolean(sheet.order);

  let path: PathResult;
  if (r1) {
    const order = sheet.order;
    const verified = sheet.identity?.verified;
    const who = verified && order ? `${order.buyer.name} (${sender.channel} ${sender.handle})` : `${sender.displayName} (${sender.channel} ${sender.handle})`;
    const prior = history.log.map((e) => `${e.daysAgo}d ago via ${e.channel}${e.answered ? "" : " (unanswered)"}: ${e.summary.replace(/\.$/, "")}`);
    path = {
      rule: "R1",
      brief: brief("escalate_upset", "escalate", "Priority handoff — no auto-answer", {
        name: greetName(sheet),
        slaHours: POLICY.escalation.urgentSlaHours,
      }),
      summary: `${r1Reasons.join("; ")}. Rule R1 sends this straight to a person — the agent does not attempt an answer, it only confirms the handoff.`,
      facts: order && verified ? [orderFact(order)] : [],
      handoff: handoff(
        "urgent",
        [
          `${who} is upset and has contacted us before.`,
          order && verified ? `Order #${order.id}: ${order.item.name}, delivered ${daysBetween(order.deliveredAt ?? order.placedAt, sheet.now)} days ago (warranty active).` : "",
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
      brief: brief(topic ? "escalate_policy_gap" : "escalate_no_policy", "escalate", topic ? `No policy: ${topic.label.toLowerCase()}` : "Not covered by policy", {
        topicId: topic?.id,
        slaHours: POLICY.escalation.standardSlaHours,
      }),
      summary: topic
        ? `The customer asks about ${topic.en}. The shop has no written policy on it, so any answer would be a guess. Rule R2: a person answers.`
        : "The message doesn't match any topic in the written policy. Rule R2: a person answers rather than the agent guessing.",
      facts: [],
      handoff: handoff(
        "normal",
        topic
          ? `${sender.displayName} (${sender.channel} ${sender.handle}) asks about ${topic.en}. No written policy exists — please answer and consider adding one.`
          : `${sender.displayName} (${sender.channel} ${sender.handle}) asked something outside the policy book.`,
        "Support team",
      ),
    };
  } else if (wantsPii) {
    path = personalDataPath(sheet, signals, sender);
  } else if (ownerGated && orderOwnerGate(sheet, signals, sender)) {
    path = orderOwnerGate(sheet, signals, sender)!;
  } else {
    switch (signals.intent.value) {
      case "order_status":
        path = orderStatusPath(sheet, signals);
        break;
      case "return_request":
        path = returnPath(sheet, signals);
        break;
      case "product_fault":
        path = faultPath(sheet);
        break;
      case "store_info":
        path = {
          rule: "R6",
          brief: brief("store_info", "resolve", "Store info", { address: SHOP.address, phone: SHOP.phone }),
          summary: "Store address and hours are in the policy book. Rule R6: answer directly.",
          facts: [{ label: "Store", value: `${SHOP.address} · ${SHOP.hours.en}`, source: "policy" }],
        };
        break;
      case "delivery_info":
        path = {
          rule: "R6",
          brief: brief("delivery_info", "resolve", "Delivery info", {
            windowMin: POLICY.delivery.windowMinDays,
            windowMax: POLICY.delivery.windowMaxDays,
            fee: POLICY.delivery.fee,
            freeOver: POLICY.delivery.freeOver,
          }),
          summary: "Delivery times and fees are in the policy book. Rule R6: answer directly.",
          facts: [{ label: "Delivery policy", value: "2–4 days · €2.50 · free over €50", source: "policy" }],
        };
        break;
      case "small_talk":
        path = {
          rule: "R6",
          brief: brief("conversation", "resolve", "Conversation", { variant: signals.smallTalk ?? "greeting" }),
          summary:
            "Small talk with no concrete request. The agent replies conversationally and offers what it can help with. It states no facts and makes no promises, so there is nothing to verify.",
          facts: [],
        };
        break;
      case "payment_methods":
        path = {
          rule: "R6",
          brief: brief("payment_methods", "resolve", "Payment methods", {}),
          summary: "Up-front payment methods are in the policy book. Rule R6: answer directly (installments are a separate, uncovered topic).",
          facts: [{ label: "Payment policy", value: "Card, cash on delivery, bank transfer", source: "policy" }],
        };
        break;
      default:
        path = {
          rule: "R2",
          brief: brief("escalate_no_policy", "escalate", "Not covered by policy", { slaHours: POLICY.escalation.standardSlaHours }),
          summary: "No written policy covers this. Rule R2: a person answers.",
          facts: [],
          handoff: handoff("normal", `${sender.displayName} asked something outside the policy book.`),
        };
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
