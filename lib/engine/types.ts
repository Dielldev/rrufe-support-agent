/**
 * Shared types for the support pipeline.
 *
 * The one thing to remember: a `Decision` is a closed set. Nothing outside the
 * deterministic rules + guard can produce a value that is not in DECISIONS,
 * and nothing downstream of the guard can change it.
 */

export const DECISIONS = ["resolve", "request_verification", "escalate"] as const;
export type Decision = (typeof DECISIONS)[number];

/** Higher = more conservative. The guard always keeps the strictest decision. */
export const STRICTNESS: Record<Decision, number> = {
  resolve: 0,
  request_verification: 1,
  escalate: 2,
};

export function strictest(a: Decision, b: Decision): Decision {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

export const DECISION_LABEL: Record<Decision, string> = {
  resolve: "Auto-resolved",
  request_verification: "Verification needed",
  escalate: "Escalated to human",
};

export const INTENTS = [
  "order_status",
  "order_list",
  "product_search",
  "return_request",
  "order_change",
  "product_fault",
  "personal_data_request",
  "store_info",
  "delivery_info",
  "payment_methods",
  "financing",
  "small_talk",
  "other",
] as const;
export type Intent = (typeof INTENTS)[number];

export type Language = "sq" | "en";
export type Channel = (typeof CHANNELS)[number];
export type PiiField = "address" | "phone" | "email";
/** Mirrors the CHECK constraint on products.category in db/schema.sql. */
export const PRODUCT_CATEGORIES = ["laptop", "headphones", "phone", "charger"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export const CHANNELS = ["email", "instagram", "viber"] as const;

/** Who sent the message, as the inbox platform reports it (not as the text claims). */
export interface Sender {
  /** `${channel}:${handle}`, e.g. "viber:+38344100101". */
  id: string;
  /** Customer profile this inbox account is linked to (set by the platform/CRM, not by message text). */
  customerId?: string;
  channel: Channel;
  handle: string;
  displayName: string;
  /** Platform-verified email (the From: address on the email channel). */
  email?: string;
  /** Platform-verified phone (the Viber account number). */
  phone?: string;
}

export interface ThreadMessage {
  senderId: string;
  text: string;
  decision?: Decision;
  /**
   * The assistant's reply to this message, so the agent can follow the
   * conversation. Client-held context: it is never treated as a verified fact.
   */
  reply?: string;
}

export interface Detection {
  hit: boolean;
  evidence: string[];
}

export type OrderChangeKind = "address" | "remove_item" | "cancel" | "general";

export interface Signals {
  language: Language;
  orderIds: string[];
  statedEmails: string[];
  statedPhones: string[];
  product?: ProductCategory;
  statedDays?: number;
  boxOpened: boolean | null;
  frustration: Detection;
  repeat: Detection;
  thirdParty: Detection & { relation?: string };
  personalData: Detection & { fields: PiiField[] };
  /** A topic recognised from keywords (installments, trade-in…), whether or not a policy covers it. */
  topic: Detection & { topicId?: string };
  /** A recognised topic with no row in the policies table. */
  policyGap: Detection & { topicId?: string };
  /** Order number mentioned earlier in this conversation by the same sender. */
  contextOrderId?: string;
  /** "under €100", "nën 100 euro": a price ceiling for a product search. */
  priceCap?: number;
  /** Says a delivered parcel can't be found / wasn't received. */
  reportsMissing: boolean;
  orderChange: Detection & { kinds: OrderChangeKind[] };
  smallTalk?: "greeting" | "thanks" | "help";
  intent: { value: Intent; evidence: string[] };
}

export type FactSource =
  | "orders"
  | "contact_log"
  | "policy"
  | "computed"
  | "customer"
  | "channel"
  | "catalog";

export type Tone = "ok" | "warn" | "bad" | "neutral";

export interface Fact {
  label: string;
  value: string;
  source: FactSource;
  tone?: Tone;
}

export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";

export interface RuleCheck {
  id: RuleId;
  title: string;
  status: "fired" | "passed" | "not_applicable";
  decision?: Decision;
  detail: string;
}

export interface Action {
  kind: "carrier_trace" | "handoff" | "withheld" | "disclosure_log" | "ticket_note" | "voucher" | "order_change";
  label: string;
  detail: string;
}

export interface Handoff {
  priority: "urgent" | "normal";
  queue: string;
  slaHours: number;
  note: string;
}

export interface SignalChip {
  label: string;
  value: string;
  source: "rules" | "jev" | "rules+jev" | "channel";
  tone: Tone;
}

export type BriefKind =
  | "order_on_time"
  | "order_late"
  | "order_delivered"
  | "orders_list"
  | "products_list"
  | "open_question"
  | "return_declined"
  | "return_eligible"
  | "return_info"
  | "warranty_repair"
  | "pii_disclose"
  | "pii_third_party"
  | "pii_unverified"
  | "order_unverified"
  | "verify_generic"
  | "need_order_number"
  | "order_not_found"
  | "delivery_info"
  | "policy_quote"
  | "warranty_handoff"
  | "escalate_upset"
  | "escalate_policy_gap"
  | "escalate_no_policy"
  | "escalate_policy_limit"
  | "escalate_review"
  | "escalate_missing_parcel"
  | "conversation"
  | "busy_retry";

export type BriefValue = string | number | boolean | string[] | undefined;

/** Everything the reply is allowed to say, decided before any model sees it. */
export interface ReplyBrief {
  kind: BriefKind;
  decision: Decision;
  params: Record<string, BriefValue>;
  /** PII values the reply may contain (only ever set for a verified buyer). */
  disclose: string[];
  /** PII values that must never appear in the reply. */
  withhold: string[];
  /** Short label shown under the status pill, e.g. "Declined per policy". */
  outcome: string;
}

export interface ProposalView {
  engine: string;
  /** Short display name: "Jev", "Groq", "Simulated model". */
  name: string;
  /** False when probabilities are the model's own guess (LLM), not a calibrated distribution (Jev). */
  calibrated?: boolean;
  ok: boolean;
  error?: string;
  latencyMs: number;
  intent?: { value: Intent; probability: number };
  decision?: { value: Decision; probability: number; probabilities?: Partial<Record<Decision, number>> };
  flags?: { frustrated: number; repeat_contact: number; third_party: number; wants_personal_data: number };
}

export type GuardOutcome =
  | "rules_only"
  | "advisory"
  | "agreed"
  | "overridden"
  | "tightened"
  | "low_confidence"
  | "model_unavailable";

export interface GuardView {
  rulesDecision: Decision;
  proposedDecision?: Decision;
  final: Decision;
  outcome: GuardOutcome;
  note: string;
}

export interface ValidationIssue {
  check:
    | "pii_leak"
    | "unapproved_number"
    | "changes_decision"
    | "new_commitment"
    | "wrong_language"
    | "missing_fact"
    | "length"
    | "model_error"
    | "internal_leak";
  detail: string;
}

export interface PhrasingView {
  /** "agent": the tool-using agent wrote the reply; it went through the same output checks. */
  engine: "model" | "template" | "agent";
  phraser?: string;
  /** Model draft that failed validation and was thrown away. */
  rejectedDraft?: string;
  issues: ValidationIssue[];
  latencyMs?: number;
}

export type OrderStatus = "pending" | "processing" | "shipped" | "delivered" | "cancelled" | "returned";

export interface ProductImage {
  name: string;
  url: string;
}

export interface OrderCardData {
  id: string;
  items: string;
  images: ProductImage[];
  total: number;
  status: OrderStatus;
  carrier?: string;
  tracking?: string;
  expectedBy?: string;
  placedDaysAgo: number;
  deliveredDaysAgo?: number;
  placedOn?: string;
  shippedOn?: string;
  deliveredOn?: string;
}

/** A delay voucher shown as a reward card. The code comes from the vouchers table. */
export type VoucherKind = "percent" | "free_shipping" | "gift_card";

export interface VoucherCardData {
  code: string;
  kind: VoucherKind;
  percent?: number;
  amountEur?: number;
  orderId: string;
  /** YYYY-MM-DD */
  expiresOn: string;
  /** True when the order already had a voucher and the existing one was shown again. */
  alreadyIssued: boolean;
}

/** Live progress while a message is being handled (streamed to the chat). */
export type ProgressEvent =
  | { type: "step"; id: string; label: string; status: "active" | "done" | "blocked" | "failed" }
  /** Reply text that already passed the output checks, sentence by sentence. */
  | { type: "text"; delta: string }
  /** Throw away the streamed text (the agent went on to call tools, or is rewriting). */
  | { type: "text-reset" };

// ---- agent -------------------------------------------------------------------

/**
 * What a tool call was allowed to do. "granted" = the requester's own data,
 * "public" = shop catalog / policy, "denied" = the requester isn't entitled to it,
 * "action" = a side effect the code allowed, "refused" = an action whose
 * preconditions (checked in code) weren't met.
 */
export type ToolAccess = "granted" | "public" | "denied" | "action" | "refused" | "error";

export interface ToolTrace {
  tool: string;
  input: Record<string, unknown>;
  access: ToolAccess;
  /** One line for the Why panel; never contains another person's data. */
  summary: string;
  latencyMs: number;
}

/** How much customer data this conversation can reach, decided by code before the agent runs. */
export type AccessScope = "account" | "per_order" | "public";

export interface AgentView {
  model: string;
  scope: { level: AccessScope; note: string };
  toolCalls: ToolTrace[];
  steps: number;
  latencyMs: number;
  /** True when the first reply failed the output checks and the agent rewrote it. */
  repaired: boolean;
  /** The reply that failed the output checks (first attempt), if any. */
  rejectedDraft?: string;
  issues: ValidationIssue[];
}

export interface TriageResult {
  id: string;
  decision: Decision;
  reply: { text: string; language: Language };
  outcome: string;
  orders?: OrderCardData[];
  vouchers?: VoucherCardData[];
  why: {
    summary: string;
    firedRule: { id: RuleId; title: string };
    checks: RuleCheck[];
    signals: SignalChip[];
    facts: Fact[];
    proposal: ProposalView | null;
    guard: GuardView;
    actions: Action[];
    withheld: string[];
    handoff?: Handoff;
    phrasing: PhrasingView;
  };
  /** Present when the tool-using agent wrote the reply. */
  agent?: AgentView;
  /** What the audit log needs: the topic and the order the facts came from (only when it exists in the records). */
  intent: Intent;
  orderId?: string;
  engines: { decision: string; phrasing: string; agent?: string };
  /** Set by the API when the message and decision were written to conversations / agent_log. */
  audit?: { convId: number } | { error: string };
  sessionId?: string;
  timings: { totalMs: number; classifierMs?: number; agentMs?: number };
}

export type RunMode = "standard" | "stress";
