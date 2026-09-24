import { getPolicyBook } from "@/lib/db/repo";
import { shopNow } from "@/lib/shop/operations";
import { decisionProvider, phrasingProvider } from "./config";
import { gatherFacts } from "./facts";
import { guard, mergeSignals } from "./guard";
import { groqProposer } from "./groq";
import { buildJevState, jevProposer, overconfidentProposer, type Proposer } from "./jev";
import { gatewayPhraser, groqPhraser, phraseReply, roguePhraser, type Phraser } from "./phrasing";
import { decide } from "./rules";
import { extractSignals } from "./signals";
import type { RunMode, Sender, ThreadMessage, TriageResult } from "./types";

export interface PipelineDeps {
  now?: Date;
  /** Proposes a decision (Jev, Groq or the stress simulator). `null` = rules only. */
  proposer: Proposer | null;
  phraser: Phraser | null;
  /** Whether to fall back to template drafts when no phrasing model is configured or when phrasing fails. */
  allowFallback?: boolean;
}

export function depsForMode(mode: RunMode, allowFallback: boolean = false): PipelineDeps {
  if (mode === "stress") return { proposer: overconfidentProposer, phraser: roguePhraser, allowFallback: true };
  const decision = decisionProvider();
  const phrasing = phrasingProvider();
  return {
    proposer: decision === "jev" ? jevProposer() : decision === "groq" ? groqProposer() : null,
    phraser: phrasing === "gateway" ? gatewayPhraser() : phrasing === "groq" ? groqPhraser() : null,
    allowFallback,
  };
}

/**
 * 1. read signals (code) → 2. look up facts (database) → 3. Jev/Groq proposes
 * (typed) → 4. rules decide → 5. guard locks → 6. model phrases → 7. validator.
 */
export async function runPipeline(
  input: { text: string; sender: Sender; thread: ThreadMessage[] },
  deps: PipelineDeps,
): Promise<TriageResult> {
  const started = performance.now();
  const now = deps.now ?? shopNow();
  const { text, sender, thread } = input;
  const priorTexts = thread.filter((m) => m.senderId === sender.id).map((m) => m.text);

  const policies = await getPolicyBook();
  const ruleSignals = extractSignals(text, priorTexts, policies);
  const initialFacts = await gatherFacts(ruleSignals, sender, thread, now, policies);

  const proposal = deps.proposer
    ? await deps.proposer(buildJevState(text, sender, initialFacts), ruleSignals.intent.value)
    : null;

  const { signals, chips, conflict } = mergeSignals(ruleSignals, proposal);
  // The model may have filled in the topic or flags; look the facts up again with the merged reading.
  const facts = proposal ? await gatherFacts(signals, sender, thread, now, policies) : initialFacts;
  const rules = decide(signals, facts, sender);
  const locked = guard(rules, proposal, conflict);

  const phrasing = await phraseReply(locked.brief, signals.language, text, deps.phraser, deps.allowFallback ?? false);

  return {
    id: crypto.randomUUID(),
    decision: locked.view.final,
    reply: { text: phrasing.text, language: signals.language },
    outcome: locked.brief.outcome,
    why: {
      summary: locked.summarySuffix ? `${rules.summary} ${locked.summarySuffix}` : rules.summary,
      firedRule: { id: rules.fired, title: rules.checks.find((c) => c.id === rules.fired)!.title },
      checks: rules.checks,
      signals: chips,
      facts: rules.facts,
      proposal,
      guard: locked.view,
      actions:
        locked.handoff && !rules.handoff
          ? [
              ...rules.actions,
              {
                kind: "handoff",
                label: `Handed to ${locked.handoff.queue}`,
                detail: `Priority ${locked.handoff.priority} · reply due within ${locked.handoff.slaHours}h`,
              },
            ]
          : rules.actions,
      withheld: rules.withheld,
      handoff: locked.handoff,
      phrasing: phrasing.view,
    },
    intent: signals.intent.value,
    orderId: facts.order?.id,
    engines: {
      decision: proposal ? proposal.engine : "rules",
      phrasing: deps.phraser?.name ?? "templates",
    },
    timings: { totalMs: Math.round(performance.now() - started) },
  };
}
