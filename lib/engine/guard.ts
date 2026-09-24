import { POLICY } from "@/lib/data/shop";
import type { RulesOutcome } from "./rules";
import {
  STRICTNESS,
  strictest,
  type Decision,
  type GuardView,
  type Handoff,
  type Intent,
  type ProposalView,
  type ReplyBrief,
  type SignalChip,
  type Signals,
} from "./types";

/** A model flag counts once P(true) reaches this. Flags can only add caution. */
export const FLAG_THRESHOLD = 0.5;
/** Self-reported LLM confidences (Groq) are not calibrated, so they need stronger evidence. */
export const LLM_FLAG_THRESHOLD = 0.7;
/** Below this, the model's decision is treated as "unsure" → a human looks. */
export const DECISION_CONFIDENCE_FLOOR = 0.5;
/** The model may fill in the topic only when the keyword reader found none and it is this sure. */
export const INTENT_ADOPT_THRESHOLD = 0.6;

export interface MergeResult {
  signals: Signals;
  chips: SignalChip[];
  conflict?: { rules: Intent; jev: Intent; probability: number };
}

const INTENT_LABEL: Record<Intent, string> = {
  order_status: "Order status",
  return_request: "Return request",
  product_fault: "Product fault",
  personal_data_request: "Personal data request",
  store_info: "Store info",
  delivery_info: "Delivery info",
  payment_methods: "Payment methods",
  financing: "Financing / installments",
  small_talk: "Small talk",
  other: "Other",
};

const pct = (p: number) => `${Math.round(p * 100)}%`;

/**
 * Combine the deterministic reading with the model's typed answers. Risk flags are
 * OR-ed (either reader can raise one, neither can clear one).
 */
export function mergeSignals(rules: Signals, proposal: ProposalView | null): MergeResult {
  const merged: Signals = structuredClone(rules);
  const chips: SignalChip[] = [];
  const jev = proposal?.ok ? proposal : undefined;
  const name = jev?.name ?? "Model";
  const source = (ruleHit: boolean, jevHit: boolean): SignalChip["source"] =>
    ruleHit && jevHit ? "rules+jev" : jevHit ? "jev" : "rules";

  chips.push({ label: "Language", value: rules.language === "sq" ? "Albanian" : "English", source: "rules", tone: "neutral" });

  let conflict: MergeResult["conflict"];
  if (jev?.intent) {
    const j = jev.intent;
    if (rules.intent.value === "other" && j.value !== "other" && j.probability >= INTENT_ADOPT_THRESHOLD) {
      merged.intent = { value: j.value, evidence: [`${name}: ${INTENT_LABEL[j.value]} (${pct(j.probability)})`] };
    } else if (
      rules.intent.value !== "other" &&
      j.value !== rules.intent.value &&
      j.probability >= INTENT_ADOPT_THRESHOLD
    ) {
      conflict = { rules: rules.intent.value, jev: j.value, probability: j.probability };
    }
  }
  chips.push({
    label: "Topic",
    value: INTENT_LABEL[merged.intent.value] + (conflict ? ` (${name}: ${INTENT_LABEL[conflict.jev]})` : ""),
    source: jev?.intent ? (jev.intent.value === merged.intent.value ? "rules+jev" : merged.intent.value === rules.intent.value ? "rules" : "jev") : "rules",
    tone: conflict ? "warn" : "neutral",
  });
  if (rules.orderIds.length) {
    chips.push({ label: "Order", value: rules.orderIds.map((id) => `#${id}`).join(", "), source: "rules", tone: "neutral" });
  }

  const threshold = jev?.calibrated === false ? LLM_FLAG_THRESHOLD : FLAG_THRESHOLD;
  const flag = (p: number | undefined) => p !== undefined && p >= threshold;
  if (jev?.flags) {
    const f = jev.flags;
    if (flag(f.frustrated) && !rules.frustration.hit) {
      merged.frustration = { hit: true, evidence: [`${name}: customer upset (${pct(f.frustrated)})`] };
    }
    if (flag(f.repeat_contact) && !rules.repeat.hit) {
      merged.repeat = { hit: true, evidence: [`${name}: repeat contact (${pct(f.repeat_contact)})`] };
    }
    if (flag(f.third_party) && !rules.thirdParty.hit) {
      merged.thirdParty = { hit: true, evidence: [`${name}: writing for someone else (${pct(f.third_party)})`] };
    }
    if (flag(f.wants_personal_data) && !rules.personalData.hit) {
      // The model can't say which field, so every field is treated as requested.
      merged.personalData = {
        hit: true,
        fields: ["address", "phone", "email"],
        evidence: [`${name}: asks for personal data (${pct(f.wants_personal_data)})`],
      };
      merged.intent = { value: "personal_data_request", evidence: merged.personalData.evidence };
    }
  }

  const risk: [string, boolean, boolean, string[]][] = [
    ["Frustration", rules.frustration.hit, flag(jev?.flags?.frustrated), merged.frustration.evidence],
    ["Repeat contact", rules.repeat.hit, flag(jev?.flags?.repeat_contact), merged.repeat.evidence],
    ["Third party", rules.thirdParty.hit, flag(jev?.flags?.third_party), merged.thirdParty.evidence],
    ["Personal data asked", rules.personalData.hit, flag(jev?.flags?.wants_personal_data), merged.personalData.evidence],
    ["Policy gap", rules.policyGap.hit, false, rules.policyGap.evidence],
  ];
  for (const [label, r, j, evidence] of risk) {
    if (r || j) chips.push({ label, value: evidence[0] ?? "detected", source: source(r, j), tone: "bad" });
  }
  if (rules.statedDays !== undefined) {
    chips.push({ label: "Customer claims", value: `${rules.statedDays} days`, source: "rules", tone: "neutral" });
  }
  if (rules.boxOpened !== null) {
    chips.push({ label: "Box", value: rules.boxOpened ? "opened (says customer)" : "sealed (says customer)", source: "rules", tone: rules.boxOpened ? "warn" : "neutral" });
  }

  return { signals: merged, chips, conflict };
}

function genericBrief(decision: Decision, base: ReplyBrief, outcome: string): ReplyBrief {
  if (decision === "escalate") {
    return { ...base, kind: "escalate_review", decision, outcome, params: { slaHours: POLICY.escalation.standardSlaHours }, disclose: [] };
  }
  return { ...base, kind: "verify_generic", decision, outcome, params: {}, disclose: [] };
}

export interface GuardResult {
  view: GuardView;
  brief: ReplyBrief;
  handoff?: Handoff;
  summarySuffix?: string;
}

/**
 * Lock the decision. The rules outcome is the floor; a model may only move it
 * toward a stricter option. It can never loosen it.
 */
export function guard(rules: RulesOutcome, proposal: ProposalView | null, conflict?: MergeResult["conflict"]): GuardResult {
  const base = { rulesDecision: rules.decision };
  if (!proposal) {
    return {
      view: { ...base, final: rules.decision, outcome: "rules_only", note: "No decision model configured — the deterministic rules decided alone." },
      brief: rules.brief,
      handoff: rules.handoff,
    };
  }
  if (!proposal.ok || !proposal.decision) {
    return {
      view: {
        ...base,
        final: rules.decision,
        outcome: "model_unavailable",
        note: `${proposal.name} was unreachable (${proposal.error ?? "no answer"}); fell back to the deterministic rules.`,
      },
      brief: rules.brief,
      handoff: rules.handoff,
    };
  }

  const proposed = proposal.decision.value;
  const p = proposal.decision.probability;
  const who = proposal.name;
  const withProposal = { ...base, proposedDecision: proposed };

  const tighten = (final: Decision, outcome: GuardView["outcome"], note: string, handoffNote: string): GuardResult => {
    const brief = final === rules.decision ? rules.brief : genericBrief(final, rules.brief, final === "escalate" ? "Flagged for human review" : "Identity check requested");
    return {
      view: { ...withProposal, final, outcome, note },
      brief,
      handoff:
        final === "escalate"
          ? rules.handoff ?? { priority: "normal", queue: "Support team", slaHours: POLICY.escalation.standardSlaHours, note: handoffNote }
          : rules.handoff,
      summarySuffix: final === rules.decision ? undefined : note,
    };
  };

  if (conflict) {
    const note = `The keyword reader says “${conflict.rules.replaceAll("_", " ")}” but ${who} says “${conflict.jev.replaceAll("_", " ")}” (${pct(conflict.probability)}). When the two readers disagree about what's being asked, a human reads it.`;
    return tighten(strictest(rules.decision, "escalate"), "tightened", note, `Readers disagree on the topic (${conflict.rules} vs ${conflict.jev}).`);
  }
  if (p < DECISION_CONFIDENCE_FLOOR) {
    const note = `${who}'s top choice (${proposed.replaceAll("_", " ")}) had only ${pct(p)} probability — too unsure to act on, so a human looks.`;
    return tighten(strictest(rules.decision, "escalate"), "low_confidence", note, "Decision model was unsure.");
  }
  if (proposed === rules.decision) {
    return {
      view: { ...withProposal, final: rules.decision, outcome: "agreed", note: `${who} proposed “${proposed.replaceAll("_", " ")}” (${pct(p)}), matching the rules.` },
      brief: rules.brief,
      handoff: rules.handoff,
    };
  }
  if (STRICTNESS[proposed] > STRICTNESS[rules.decision]) {
    const note = `${who} proposed the stricter “${proposed.replaceAll("_", " ")}” (${pct(p)}). A model may always add caution, so the guard accepted it.`;
    return tighten(proposed, "tightened", note, `${who} flagged this for a human even though the rules would have answered.`);
  }
  return {
    view: {
      ...withProposal,
      final: rules.decision,
      outcome: "overridden",
      note: `${who} proposed “${proposed.replaceAll("_", " ")}” at ${pct(p)} confidence, but rule ${rules.fired} requires “${rules.decision.replaceAll("_", " ")}”. Confidence doesn't override facts — the guard kept the rules' decision.`,
    },
    brief: rules.brief,
    handoff: rules.handoff,
  };
}
