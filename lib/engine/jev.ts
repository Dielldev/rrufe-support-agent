import { experimental_evaluate as evaluate, type Experimental_EvaluationModel as EvaluationModel } from "ai";
import { safeModelError } from "./errors";
import type { FactSheet } from "./facts";
import { OPS } from "@/lib/shop/operations";
import { daysBetween } from "./text";
import { DECISIONS, INTENTS, type Decision, type Intent, type ProposalView, type Sender } from "./types";

export type JevState = ReturnType<typeof buildJevState>;

/** Anything that can propose a decision: Jev, Groq, or the stress-test simulator. */
export type Proposer = (state: JevState, rulesIntent: Intent) => Promise<ProposalView>;

/*
 * Jev (TypeSafe AI) via Vercel AI Gateway. It returns typed answers with
 * probabilities — a choice from our fixed option lists, never free text — so
 * its proposal can be checked mechanically by the guard.
 */

export const JEV_MODEL_ID = "typesafe-ai/jev";

type EvaluationModelInstance = Exclude<EvaluationModel, string>;

const INTENT_CRITERIA: Record<Intent, string> = {
  order_status: "Where a placed order is, or why it hasn't arrived yet",
  order_list: "Asking how many orders they have, to list their orders, or what orders are on their account",
  product_search: "Asks about products the shop sells: which models, prices, availability or stock",
  return_request: "Wants to return an item or get money back for it",
  order_change: "Wants to change an order they placed: a new delivery address, removing an item or lowering a quantity, or cancelling it",
  product_fault: "A purchased product is broken, faulty or needs repair / warranty service",
  personal_data_request: "Wants the shop to reveal or confirm the address, phone number or email on an order",
  store_info: "Store location, opening hours or how to reach the shop",
  delivery_info: "General delivery costs, areas or times — not about a specific placed order",
  payment_methods: "How the customer can pay up front (for example card, cash on delivery or bank transfer)",
  financing: "Paying in installments, monthly payments, credit, leasing or other financing",
  small_talk: "Greetings, thanks, pleasantries or asking what the assistant can do — no concrete request yet",
  other: "Anything else",
};

export const JEV_QUESTIONS = {
  intent: {
    type: "choice",
    instructions: "What is the customer mainly asking for?",
    criteria: INTENT_CRITERIA,
  },
  frustrated: {
    type: "boolean",
    instructions:
      "Is the customer clearly angry — shouting in capitals, insults, hostile wording or open exasperation? Calmly reporting a delay or a problem is NOT anger.",
  },
  repeat_contact: {
    type: "boolean",
    instructions:
      "Does the customer say they already contacted the shop about this before without a satisfying answer, or do the facts show earlier unanswered contacts? A first message is NOT repeat contact.",
  },
  third_party: {
    type: "boolean",
    instructions:
      "Is the writer acting for someone else (a relative, friend or colleague) rather than writing as the buyer themself?",
  },
  wants_personal_data: {
    type: "boolean",
    instructions: "Is the writer asking the shop to reveal or confirm the delivery address, phone number or email on an order?",
  },
  decision: {
    type: "choice",
    instructions:
      "Given the verified facts and the shop policy, what should the support agent do with this message?",
    criteria: {
      resolve:
        "The shop's records, product catalog or written policy can answer it (or it's a general question the assistant can help with), and no personal data would go to anyone other than the verified owner.",
      request_verification:
        "The requester's identity or a missing order detail must be confirmed before anything can be shared or approved.",
      escalate:
        "A person must handle it: the customer is upset or has written before, it asks about a topic the shop explicitly has no written policy for (installments, trade-ins, price matching, business orders), a faulty product, or a dispute.",
    },
  },
} as const;

const ESCALATION_POLICY =
  "Upset or repeat customers, and topics the shop has no written policy for, go to a human. Otherwise an assistant with read access to the requester's own records, the product catalog and the written policy answers.";

/**
 * State sent to Jev (and Groq). Deliberately contains no names, addresses, phones
 * or emails. The policy is the shop's policies table, verbatim.
 */
export function buildJevState(text: string, sender: Sender, sheet: FactSheet) {
  const o = sheet.order;
  return {
    shop: `${OPS.shopName} — electronics shop in Kosovo`,
    channel: sender.channel,
    customer_message: text,
    verified_facts: {
      order_referenced: sheet.requestedOrderId ?? null,
      order_found: Boolean(o),
      order_status: o?.status ?? null,
      courier_status: o?.shipment?.tracking ?? null,
      days_since_order: o ? daysBetween(o.placedAt, sheet.today) : null,
      days_past_expected_delivery: o?.shipment && !o.deliveredAt ? Math.max(0, daysBetween(o.shipment.expectedMax, sheet.today)) : null,
      days_since_delivery: o?.deliveredAt ? daysBetween(o.deliveredAt, sheet.today) : null,
      requester_is_verified_buyer: sheet.identity?.verified ?? false,
      earlier_unanswered_contacts: sheet.history.unanswered,
    },
    policy: {
      ...Object.fromEntries(sheet.policies.rows.map((r) => [r.topic, r.text])),
      escalation: ESCALATION_POLICY,
    },
  };
}

function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export async function proposeWithJev(
  model: EvaluationModel,
  state: JevState,
  engineLabel: string,
  name = "Jev",
): Promise<ProposalView> {
  const started = performance.now();
  try {
    const result = await evaluate({
      model,
      state,
      questions: JEV_QUESTIONS,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(8_000),
      providerOptions: { gateway: { zeroDataRetention: true } },
    });
    const a = result.answers;
    // Anything outside the fixed lists collapses to the most conservative option.
    const intent = pick<Intent>(a.intent.choice, INTENTS, "other");
    const decision = pick<Decision>(a.decision.choice, DECISIONS, "escalate");
    const decisionProbs = a.decision.probabilities as Partial<Record<Decision, number>> | undefined;
    return {
      engine: engineLabel,
      name,
      ok: true,
      latencyMs: Math.round(performance.now() - started),
      intent: { value: intent, probability: a.intent.probabilities?.[a.intent.choice] ?? 1 },
      decision: { value: decision, probability: decisionProbs?.[decision] ?? 1, probabilities: decisionProbs },
      flags: {
        frustrated: a.frustrated.probability,
        repeat_contact: a.repeat_contact.probability,
        third_party: a.third_party.probability,
        wants_personal_data: a.wants_personal_data.probability,
      },
    };
  } catch (err) {
    return {
      engine: engineLabel,
      name,
      ok: false,
      error: safeModelError(err, "Jev call failed"),
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

/**
 * Stress-test stand-in for Jev: understands the topic, but always claims there
 * is no risk and proposes "resolve" at 99%. Used to prove the guard holds.
 */
export function overconfidentModel(intent: Intent): EvaluationModelInstance {
  const spread = (chosen: string, keys: readonly string[]) => {
    const rest = (1 - 0.99) / (keys.length - 1);
    return Object.fromEntries(keys.map((k) => [k, k === chosen ? 0.99 : rest]));
  };
  return {
    specificationVersion: "v4",
    provider: "stress-test",
    modelId: "overconfident-simulator",
    supportedQuestionTypes: ["choice", "boolean", "score"],
    async doEvaluate() {
      return {
        answers: {
          intent: { type: "choice", choice: intent, probabilities: spread(intent, INTENTS) },
          frustrated: { type: "boolean", probability: 0.01 },
          repeat_contact: { type: "boolean", probability: 0.01 },
          third_party: { type: "boolean", probability: 0.01 },
          wants_personal_data: { type: "boolean", probability: 0.01 },
          decision: { type: "choice", choice: "resolve", probabilities: spread("resolve", DECISIONS) },
        },
        warnings: [],
      };
    },
  };
}

export function jevProposer(model: EvaluationModel = JEV_MODEL_ID, engine = JEV_MODEL_ID): Proposer {
  return (state) => proposeWithJev(model, state, engine, "Jev");
}

export const overconfidentProposer: Proposer = (state, intent) =>
  proposeWithJev(overconfidentModel(intent), state, "overconfident-simulator (stress test)", "Simulated model");
