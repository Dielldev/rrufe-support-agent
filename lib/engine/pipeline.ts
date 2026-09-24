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
}

export function depsForMode(mode: RunMode): PipelineDeps {
  if (mode === "stress") return { proposer: overconfidentProposer, phraser: roguePhraser };
  const decision = decisionProvider();
  const phrasing = phrasingProvider();
  return {
    proposer: decision === "jev" ? jevProposer() : decision === "groq" ? groqProposer() : null,
    phraser: phrasing === "gateway" ? gatewayPhraser() : phrasing === "groq" ? groqPhraser() : null,
  };
}

/**
 * 1. read signals (code) → 2. look up facts (code + records) → 3. Jev/Groq proposes
 * (typed) → 4. rules decide → 5. guard locks → 6. model phrases → 7. validator.
 */
export async function runPipeline(
  input: { text: string; sender: Sender; thread: ThreadMessage[] },
  deps: PipelineDeps,
): Promise<TriageResult> {
  const started = performance.now();
  const now = deps.now ?? new Date();
  const { text, sender, thread } = input;
  const priorTexts = thread.filter((m) => m.senderId === sender.id).map((m) => m.text);

  const ruleSignals = extractSignals(text, priorTexts);
  const initialFacts = gatherFacts(ruleSignals, sender, thread, now);

  const proposal = deps.proposer
    ? await deps.proposer(buildJevState(text, sender, initialFacts), ruleSignals.intent.value)
    : null;

  const { signals, chips, conflict } = mergeSignals(ruleSignals, proposal);
  const facts = gatherFacts(signals, sender, thread, now);
  const rules = decide(signals, facts, sender);
  const locked = guard(rules, proposal, conflict);

  const phrasing = await phraseReply(locked.brief, signals.language, text, deps.phraser);

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
    engines: {
      decision: proposal ? proposal.engine : "rules",
      phrasing: deps.phraser?.name ?? "templates",
    },
    timings: { totalMs: Math.round(performance.now() - started) },
  };
}
