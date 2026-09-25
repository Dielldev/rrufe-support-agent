/*
 * The written policy, as stored in the `policies` table. The agent may only state
 * what is in this table: a topic with no row is a topic the agent never answers.
 *
 * `rule_text` is the human wording (quoted to customers and shown on the Policies
 * page); `value` is the machine-readable form the rules compute with. When a value
 * can't be read, the topic still counts as covered for quoting, but the computed
 * paths that need numbers escalate instead of guessing.
 */

export interface PolicyRow {
  topic: string;
  text: string;
  value: string | null;
}

export interface DeliveryPolicy {
  minDays: number;
  maxDays: number;
  /** "2-4 working days" → true: windows skip weekends. */
  workingDays: boolean;
  text: string;
}

export interface ReturnsPolicy {
  windowDays: number;
  unopenedOnly: boolean;
  text: string;
}

export interface DelayRewardTier {
  reward: "free_shipping" | "gift_card";
  minDaysLate: number;
  minOrderEur: number;
  amountEur?: number;
}

export interface DelayCompensationPolicy {
  percent: number;
  validDays: number;
  tiers: DelayRewardTier[];
  text: string;
}

export interface OrderChangesPolicy {
  editableStatuses: ("pending" | "processing")[];
  selfServicePayments: "cash_on_delivery"[];
  maxAddressChanges: number;
  text: string;
}

export type WarrantyPolicy = { kind: "human_staff"; text: string } | { kind: "months"; months: number; text: string };

export interface PolicyBook {
  rows: PolicyRow[];
  topics: string[];
  delivery?: DeliveryPolicy;
  returns?: ReturnsPolicy;
  warranty?: WarrantyPolicy;
  delayCompensation?: DelayCompensationPolicy;
  orderChanges?: OrderChangesPolicy;
}

function json(value: string | null): Record<string, unknown> | undefined {
  if (!value?.trim().startsWith("{")) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function parseDelivery(row: PolicyRow): DeliveryPolicy | undefined {
  const j = json(row.value);
  const range = row.value?.match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*$/);
  const min = range ? Number(range[1]) : Number(j?.min_days);
  const max = range ? Number(range[2]) : Number(j?.max_days);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return undefined;
  const workingDays = j?.working_days === true || /\b(working|business)\s+days\b|dit[eë] pune/i.test(row.text);
  return { minDays: min, maxDays: max, workingDays, text: row.text };
}

function parseReturns(row: PolicyRow): ReturnsPolicy | undefined {
  const j = json(row.value);
  const days = j ? Number(j.window_days) : Number(row.value);
  if (!Number.isInteger(days) || days <= 0) return undefined;
  const unopenedOnly = j?.unopened_only === true || /\b(unopened|sealed|unused)\b|pahapur/i.test(row.text);
  return { windowDays: days, unopenedOnly, text: row.text };
}

function parseWarranty(row: PolicyRow): WarrantyPolicy | undefined {
  const v = row.value?.trim();
  if (v === "human_staff") return { kind: "human_staff", text: row.text };
  const months = json(v ?? null)?.months ?? (v && /^\d+$/.test(v) ? Number(v) : undefined);
  if (Number.isInteger(months) && Number(months) > 0) return { kind: "months", months: Number(months), text: row.text };
  return undefined;
}

function parseDelayCompensation(row: PolicyRow): DelayCompensationPolicy | undefined {
  const j = json(row.value);
  const percent = Number(j?.percent);
  const validDays = Number(j?.valid_days);
  // Hard cap: a policy row can't make the agent hand out more than 20%.
  if (!Number.isInteger(percent) || percent <= 0 || percent > 20) return undefined;
  if (!Number.isInteger(validDays) || validDays <= 0 || validDays > 365) return undefined;
  const tiers: DelayRewardTier[] = [];
  for (const t of Array.isArray(j?.tiers) ? (j.tiers as Record<string, unknown>[]) : []) {
    const minDaysLate = Number(t.min_days_late);
    const minOrderEur = Number(t.min_order_eur);
    if (!Number.isInteger(minDaysLate) || minDaysLate < 1 || !Number.isFinite(minOrderEur) || minOrderEur < 0) continue;
    if (t.reward === "free_shipping") tiers.push({ reward: "free_shipping", minDaysLate, minOrderEur });
    if (t.reward === "gift_card") {
      const amountEur = Number(t.amount_eur);
      if (Number.isFinite(amountEur) && amountEur > 0 && amountEur <= 10) tiers.push({ reward: "gift_card", minDaysLate, minOrderEur, amountEur });
    }
  }
  return { percent, validDays, tiers, text: row.text };
}

const EDITABLE_STATUSES = ["pending", "processing"] as const;

function parseOrderChanges(row: PolicyRow): OrderChangesPolicy | undefined {
  const j = json(row.value);
  if (!j) return undefined;
  const statuses = Array.isArray(j.statuses) ? j.statuses : [];
  const editableStatuses = EDITABLE_STATUSES.filter((s) => statuses.includes(s));
  const payments = Array.isArray(j.self_service_payments) ? j.self_service_payments : [];
  const selfServicePayments: "cash_on_delivery"[] = payments.includes("cash_on_delivery") ? ["cash_on_delivery"] : [];
  const maxAddressChanges = Number(j.max_address_changes);
  if (!editableStatuses.length) return undefined;
  if (!Number.isInteger(maxAddressChanges) || maxAddressChanges < 1 || maxAddressChanges > 5) return undefined;
  return { editableStatuses, selfServicePayments, maxAddressChanges, text: row.text };
}

export function buildPolicyBook(rows: PolicyRow[]): PolicyBook {
  const find = (topic: string) => rows.find((r) => r.topic === topic);
  const delivery = find("delivery");
  const returns = find("returns");
  const warranty = find("warranty");
  const delay = find("delay_compensation");
  const changes = find("order_changes");
  return {
    rows,
    topics: rows.map((r) => r.topic),
    delivery: delivery && parseDelivery(delivery),
    returns: returns && parseReturns(returns),
    warranty: warranty && parseWarranty(warranty),
    delayCompensation: delay && parseDelayCompensation(delay),
    orderChanges: changes && parseOrderChanges(changes),
  };
}

export function covers(book: PolicyBook, topic: string | null | undefined): boolean {
  return Boolean(topic && book.topics.includes(topic));
}

export function policyText(book: PolicyBook, topic: string): string | undefined {
  return book.rows.find((r) => r.topic === topic)?.text;
}
