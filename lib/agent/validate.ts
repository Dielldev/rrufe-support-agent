import { EMAIL, PHONE, STREET, numbersIn } from "@/lib/engine/phrasing";
import { detectLanguage, normPhone, rx } from "@/lib/engine/text";
import type { Language, ValidationIssue } from "@/lib/engine/types";
import { OPS } from "@/lib/shop/operations";
import type { PolicyBook } from "@/lib/shop/policies";
import type { ToolLedger } from "./ledger";
import { TOOL_NAMES } from "./tools";

/*
 * Output checks for agent replies. The phrasing validator compares a rewrite
 * against one approved draft; an agent has no draft, so here the approved facts
 * are "whatever the tools returned in this run" (the ledger) plus the written
 * policy. Deterministic, no model involved.
 */

export interface ReplyCheckContext {
  ledger: ToolLedger;
  language: Language;
  /** This sender's own messages in the conversation (they may be echoed back). */
  customerTexts: string[];
  policies: PolicyBook;
  /** Every email, phone and address the shop holds (repo.protectedPersonalData). */
  protectedValues: string[];
  /**
   * Checking one streamed sentence rather than the whole reply: skip the checks
   * that only make sense on the complete text (length, language).
   */
  partial?: boolean;
}

const LANGUAGE_NAME: Record<Language, string> = { sq: "Albanian", en: "English" };

/** Lower-case, strip diacritics (ë → e) and collapse spaces, so "Nëna Terezë" matches "Nena Tereze". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");
}

const PHONE_LIKE = /\+?\d[\d\s.-]{6,}\d/g;

function phonesIn(text: string): string[] {
  return (text.match(PHONE_LIKE) ?? []).map(normPhone).filter((p) => p.length >= 7);
}

/** Promise words, grouped by meaning (English + Albanian). */
const COMMITMENT_CONCEPTS: { name: string; terms: RegExp[] }[] = [
  { name: "refund", terms: [rx(String.raw`\brefund\w*`), rx(String.raw`\brimburs\w*`), rx(String.raw`\bmoney back\b`), rx(String.raw`\bpar[aeë]t? mbrapsht\b`)] },
  { name: "replacement", terms: [rx(String.raw`\breplac\w*`), rx(String.raw`\bz[eë]vend[eë]s\w*`)] },
  { name: "free", terms: [rx(String.raw`(?<!feel )\bfree\b(?! (?:to|of))`), rx(String.raw`\bfalas\b`)] },
  { name: "approval", terms: [rx(String.raw`\bapprov\w*`), rx(String.raw`\baprov\w*`), rx(String.raw`\bmiratim\w*`)] },
  { name: "exception", terms: [rx(String.raw`\bexception\w*`), rx(String.raw`\bp[eë]rjashtim\w*`)] },
  { name: "compensation", terms: [rx(String.raw`\bcompensat\w*`), rx(String.raw`\bkompensim\w*`)] },
  {
    name: "discount",
    terms: [rx(String.raw`\bdiscount\w*`), rx(String.raw`\bvoucher\w*`), rx(String.raw`\bcoupon\w*`), rx(String.raw`\bzbritj\w*`), rx(String.raw`\bkupon\w*`), rx(String.raw`\bvauçer\w*`)],
  },
  { name: "guarantee", terms: [rx(String.raw`\bguarantee\w*`), rx(String.raw`\bgarantoj\w*`)] },
];

const INTERNAL = rx(
  String.raw`\b(${TOOL_NAMES.join("|")}|system prompt|my instructions|tool (?:call|result)s?|what_to_tell_the_customer|staff_handoff_required|carrier_trace_available|access (?:is )?"?denied"?|output check\w*)\b`,
);

/** Numbered-list markers ("1." / "2)") at the start of a line aren't facts. */
const LIST_MARKER = /^\s*\d{1,2}[.)]\s/gm;

export function validateAgentReply(output: string, ctx: ReplyCheckContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const text = output.trim();
  const facts = ctx.ledger.factText();
  const policyText = ctx.policies.rows.map((r) => r.text).join("\n");
  const customer = ctx.customerTexts.join("\n");
  const allowed = fold(`${facts}\n${customer}`);
  const allowedPhones = new Set(phonesIn(`${facts}\n${customer}`));

  if (!ctx.partial) {
    if (text.length < 2) return [{ check: "length", detail: "Empty reply" }];
    if (text.length > 1600) issues.push({ check: "length", detail: `Length ${text.length} chars` });
  }

  // 1. Personal data: any value the shop holds must have come from a tool in this run
  //    (so it's the requester's own) or from the requester's own messages.
  const folded = fold(text);
  const outPhones = new Set(phonesIn(text));
  for (const value of ctx.protectedValues) {
    if (/@/.test(value)) {
      const v = fold(value);
      if (folded.includes(v) && !allowed.includes(v)) issues.push({ check: "pii_leak", detail: "Contains an email the requester isn't entitled to" });
    } else if (/^\+?[\d\s-]{7,}$/.test(value)) {
      const v = normPhone(value);
      if (outPhones.has(v) && !allowedPhones.has(v)) issues.push({ check: "pii_leak", detail: "Contains a phone number the requester isn't entitled to" });
    } else {
      const street = fold(value.split(",")[0]);
      if (street.length >= 6 && folded.includes(street) && !allowed.includes(street)) {
        issues.push({ check: "pii_leak", detail: "Contains an address the requester isn't entitled to" });
      }
    }
  }
  //    …and nothing that merely looks like contact data unless a tool returned it.
  for (const email of text.match(EMAIL) ?? []) {
    if (!allowed.includes(fold(email))) issues.push({ check: "pii_leak", detail: `Unapproved email “${email}”` });
  }
  for (const phone of text.match(PHONE) ?? []) {
    if (!allowedPhones.has(normPhone(phone))) issues.push({ check: "pii_leak", detail: `Unapproved phone number “${phone}”` });
  }
  if (STREET.test(text) && !/"shipping_address"/.test(facts)) {
    issues.push({ check: "pii_leak", detail: "Contains a street address although no order address was looked up" });
  }

  // 2. Numbers (days, prices, dates, counts) must come from tool results, the
  //    policy, the service levels or the customer's own message.
  const allowedNumbers = new Set([
    "0",
    "1",
    ...numbersIn(facts),
    ...numbersIn(policyText),
    ...numbersIn(customer),
    ...[OPS.urgentSlaHours, OPS.standardSlaHours].map(String),
  ]);
  const invented = [...new Set(numbersIn(text.replace(LIST_MARKER, " ")).filter((n) => !allowedNumbers.has(n)))];
  if (invented.length) issues.push({ check: "unapproved_number", detail: `Numbers not in any tool result or policy: ${invented.join(", ")}` });

  // 3. No offers or promises the records and policy don't contain. Terms are
  //    grouped by meaning so an Albanian reply ("kupon") can rely on an English
  //    record ("voucher"). In a handoff reply, echoing what the customer asked
  //    for ("your refund request is with a colleague") is allowed.
  const approvedWording = `${facts}\n${policyText}`;
  const handoffEcho = ctx.ledger.handoff ? customer : "";
  for (const concept of COMMITMENT_CONCEPTS) {
    const hit = concept.terms.map((t) => text.match(t)?.[0]).find(Boolean);
    if (!hit) continue;
    const supported = concept.terms.some((t) => t.test(approvedWording) || t.test(handoffEcho));
    if (!supported) issues.push({ check: "new_commitment", detail: `Offers “${hit}”, which no record or policy supports` });
  }

  // 4. Language and internals.
  if (!ctx.partial && text.length > 40 && detectLanguage(text) !== ctx.language) {
    issues.push({ check: "wrong_language", detail: `Reply isn't in ${LANGUAGE_NAME[ctx.language]}` });
  }
  const internal = text.match(INTERNAL);
  if (internal) issues.push({ check: "internal_leak", detail: `Mentions internals (“${internal[0]}”)` });

  return dedupe(issues);
}

function dedupe(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.check}:${i.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
