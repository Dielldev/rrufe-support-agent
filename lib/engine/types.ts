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
  "return_request",
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
}

export interface Detection {
  hit: boolean;
  evidence: string[];
}

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
  /** Says a delivered parcel can't be found / wasn't received. */
  reportsMissing: boolean;
  smallTalk?: "greeting" | "thanks" | "help";
  intent: { value: Intent; evidence: string[] };
}

export type FactSource =
  | "orders"
  | "contact_log"
  | "policy"
  | "computed"
  | "customer"
  | "channel";

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
  kind: "carrier_trace" | "handoff" | "withheld" | "disclosure_log" | "ticket_note";
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
  | "conversation";

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
  check: "pii_leak" | "unapproved_number" | "changes_decision" | "new_commitment" | "wrong_language" | "missing_fact" | "length" | "model_error";
  detail: string;
}

export interface PhrasingView {
  engine: "model" | "template";
  phraser?: string;
  /** Model draft that failed validation and was thrown away. */
  rejectedDraft?: string;
  issues: ValidationIssue[];
  latencyMs?: number;
}

export interface TriageResult {
  id: string;
  decision: Decision;
  reply: { text: string; language: Language };
  outcome: string;
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
  /** What the audit log needs: the topic and the order the facts came from (only when it exists in the records). */
  intent: Intent;
  orderId?: string;
  engines: { decision: string; phrasing: string };
  /** Set by the API when the message and decision were written to conversations / agent_log. */
  audit?: { convId: number } | { error: string };
  timings: { totalMs: number };
}

export type RunMode = "standard" | "stress";
