import { grantAccess, type AccessGrant } from "@/lib/agent/access";
import { gatewayAgent, groqAgent, openRouterAgent, rogueAgent, type AgentModel } from "@/lib/agent/models";
import { confirmChanges } from "@/lib/agent/confirm";
import { renderDraft } from "./templates";
import { AgentRejectedError, derivedDecision, runAgent, type AgentRunResult } from "@/lib/agent/run";
import { getPolicyBook, protectedPersonalData, type Order } from "@/lib/db/repo";
import { OPS, shopNow } from "@/lib/shop/operations";
import { agentProvider, decisionProvider, phrasingProvider } from "./config";
import { gatherFacts, type FactSheet } from "./facts";
import { guard, mergeSignals, type GuardResult } from "./guard";
import { groqConfigured, groqProposer } from "./groq";
import { buildJevState, jevProposer, overconfidentProposer, type Proposer } from "./jev";
import { gatewayPhraser, groqPhraser, phraseReply, roguePhraser, type Phraser } from "./phrasing";
import { decide, type RulesOutcome } from "./rules";
import { extractSignals } from "./signals";
import { daysBetween, isoDay } from "./text";
import {
  STRICTNESS,
  type Action,
  type AgentView,
  type BriefKind,
  type OrderCardData,
  type ProgressEvent,
  type ProposalView,
  type RunMode,
  type Sender,
  type SignalChip,
  type Signals,
  type ThreadMessage,
  type TriageResult,
} from "./types";

export interface PipelineDeps {
  now?: Date;
  /** Proposes a decision (Jev, Groq or the stress simulator). `null` = rules only. */
  proposer: Proposer | null;
  phraser: Phraser | null;
  /**
   * Tool-using agent that writes the reply when the intake checks don't hand the
   * message to a person. `null`/absent = the fixed rule paths and templates answer.
   */
  agent?: AgentModel | null;
  /** Whether to fall back to template drafts when no phrasing model is configured or when phrasing fails. */
  allowFallback?: boolean;
  /** Live progress for the chat: steps, and reply text that already passed the checks. */
  onEvent?: (e: ProgressEvent) => void;
}

export function depsForMode(mode: RunMode, allowFallback: boolean = false): PipelineDeps {
  if (mode === "stress") return { proposer: overconfidentProposer, phraser: roguePhraser, agent: rogueAgent, allowFallback: true };
  const decision = decisionProvider();
  const phrasing = phrasingProvider();
  const agent = agentProvider();
  return {
    proposer: decision === "jev" ? jevProposer() : decision === "groq" ? groqProposer() : null,
    phraser: phrasing === "gateway" ? gatewayPhraser() : phrasing === "groq" ? groqPhraser() : null,
    agent:
      agent === "openrouter"
        ? openRouterAgent(groqConfigured() && process.env.GROQ_DISABLED !== "1" ? groqAgent() : undefined)
        : agent === "gateway"
          ? gatewayAgent()
          : agent === "groq"
            ? groqAgent()
            : null,
    allowFallback,
  };
}

function formatOrderCard(o: Order, today: Date): OrderCardData {
  return {
    id: o.id,
    items: o.items.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}${i.opened ? " (opened)" : ""}`).join(", "),
    images: o.items.flatMap((i) => (i.imageUrl ? [{ name: i.name, url: i.imageUrl }] : [])),
    total: o.items.reduce((sum, i) => sum + i.qty * i.price, 0),
    status: o.status,
    carrier: o.shipment?.carrier,
    tracking: o.shipment?.tracking,
    expectedBy: o.shipment ? isoDay(o.shipment.expectedMax) : undefined,
    placedDaysAgo: daysBetween(o.placedAt, today),
    deliveredDaysAgo: o.deliveredAt ? daysBetween(o.deliveredAt, today) : undefined,
    placedOn: isoDay(o.placedAt),
    shippedOn: o.shipment ? isoDay(o.shipment.shippedAt) : undefined,
    deliveredOn: o.deliveredAt ? isoDay(o.deliveredAt) : undefined,
  };
}

const TOOL_LABEL: Record<string, string> = {
  get_my_account: "own profile",
  list_my_orders: "own orders",
  get_order: "an order",
  search_products: "the catalog",
  open_carrier_trace: "a carrier trace",
  issue_delay_voucher: "a delay voucher",
  change_delivery_address: "an address change",
  remove_order_item: "an order change",
  cancel_order: "a cancellation",
  request_human: "a handoff",
};

/** Replies that are about a specific order the requester may see: only these get an order card. */
const ORDER_BRIEFS: BriefKind[] = [
  "order_on_time",
  "order_late",
  "order_delivered",
  "orders_list",
  "return_declined",
  "return_eligible",
  "warranty_repair",
  "pii_disclose",
];

/** Plain-language outcome under the status pill for an agent reply. */
function agentOutcome(run: AgentRunResult, decision: TriageResult["decision"]): string {
  if (decision === "escalate") return "Handed to a person";
  if (decision === "request_verification") return "Verification requested";
  const used = [...new Set(run.ledger.traces.filter((t) => t.tool !== "preload" && (t.access === "granted" || t.access === "public" || t.access === "action")).map((t) => t.tool))];
  if (used.includes("cancel_order")) return "Order cancelled";
  if (used.includes("change_delivery_address") || used.includes("remove_order_item")) return "Order updated";
  if (used.includes("issue_delay_voucher")) return "Delay voucher issued";
  if (used.includes("open_carrier_trace")) return "Carrier trace opened";
  if (used.includes("search_products") && used.length === 1) return "Answered from the catalog";
  if (used.length) return "Answered from records";
  return "Answered";
}

function agentSummary(rules: RulesOutcome, locked: GuardResult, run: AgentRunResult): string {
  const calls = run.ledger.traces;
  const denied = calls.filter((t) => t.access === "denied").length;
  const tools = calls.length
    ? `The agent made ${calls.length} tool call${calls.length === 1 ? "" : "s"} (${[...new Set(calls.map((t) => TOOL_LABEL[t.tool] ?? t.tool))].join(", ")})${denied ? `; ${denied} ${denied === 1 ? "was" : "were"} refused by the access check` : ""}.`
    : "The agent answered without looking anything up.";
  const handoff = run.ledger.handoff ? " It handed the conversation to a person." : "";
  const gate = locked.summarySuffix ? `${rules.summary} ${locked.summarySuffix}` : rules.summary;
  return `Intake: ${gate} ${tools}${handoff}`;
}

/** Two grants reach the same data iff they have the same level and account. */
const grantKey = (g: AccessGrant) => `${g.level}:${g.accountId ?? ""}`;

interface Stage {
  signals: Signals;
  facts: FactSheet;
  rules: RulesOutcome;
  locked: GuardResult;
  proposal: ProposalView | null;
  chips: SignalChip[];
}

/**
 * 1. read signals (code) → 2. look up facts (database) → 3. Jev/Groq proposes
 * (typed; runs in parallel with the agent) → 4. rules decide → 5. guard locks →
 * 6a. agent answers with scoped tools, or 6b. model phrases the rule's draft →
 * 7. output checks.
 */
export async function runPipeline(
  input: { text: string; sender: Sender; thread: ThreadMessage[] },
  deps: PipelineDeps,
): Promise<TriageResult> {
  const started = performance.now();
  const emit = deps.onEvent ?? (() => {});
  const now = deps.now ?? shopNow();
  const { text, sender, thread } = input;
  const priorTexts = thread.filter((m) => m.senderId === sender.id).map((m) => m.text);
  const agent = deps.agent ?? null;

  emit({ type: "step", id: "intake", label: "Reading your message", status: "active" });
  const policies = await getPolicyBook();
  const ruleSignals = extractSignals(text, priorTexts, policies);
  const initialFacts = await gatherFacts(ruleSignals, sender, thread, now, policies);
  emit({ type: "step", id: "intake", label: "Reading your message", status: "done" });

  if (deps.proposer) emit({ type: "step", id: "classify", label: "Checking tone and risk", status: "active" });
  const classifierStarted = performance.now();
  const proposalPromise = deps.proposer
    ? deps.proposer(buildJevState(text, sender, initialFacts), ruleSignals.intent.value)
    : Promise.resolve(null);

  const settle = async (): Promise<Stage & { classifierMs?: number }> => {
    const proposal = await proposalPromise;
    const classifierMs = deps.proposer ? Math.round(performance.now() - classifierStarted) : undefined;
    if (deps.proposer) emit({ type: "step", id: "classify", label: "Checking tone and risk", status: "done" });
    const { signals, chips, conflict } = mergeSignals(ruleSignals, proposal);
    // The model may have filled in the topic or flags; look the facts up again with the merged reading.
    const facts = proposal ? await gatherFacts(signals, sender, thread, now, policies) : initialFacts;
    const rules = decide(signals, facts, sender, { agent: Boolean(agent) });
    const locked = guard(rules, proposal, conflict, { advisory: Boolean(agent) });
    return { signals, facts, rules, locked, proposal, chips, classifierMs };
  };

  if (!agent) {
    const stage = await settle();
    return rulePath(stage, { input, deps, emit, started, classifierMs: stage.classifierMs });
  }

  // ---- agent mode: start the agent on the keyword reading while the classifier runs ----
  const protectedValues = protectedPersonalData();
  const grantFor = (signals: Signals, facts: FactSheet) => grantAccess({ sender, signals, now, today: facts.today, policies });

  // Text from a speculative run is held back until the classifier agrees on who may see what.
  let confirmed = false;
  let heldText: ProgressEvent[] = [];
  const agentEmit = (e: ProgressEvent) => {
    if (e.type === "step" || confirmed) return emit(e);
    heldText.push(e);
  };

  const startAgent = (signals: Signals, facts: FactSheet, rules: RulesOutcome, gate: GuardResult) => {
    const controller = new AbortController();
    const grant = grantFor(signals, facts);
    const agentStarted = performance.now();
    const promise = protectedValues
      .then((pv) =>
        runAgent(
          { text, thread, grant, language: signals.language, gate: gate.view.final, mood: rules.mood, protectedValues: pv },
          agent,
          { onEvent: agentEmit, signal: controller.signal },
        ),
      )
      .then(
        (run) => ({ ok: true as const, run, ms: Math.round(performance.now() - agentStarted) }),
        (error: unknown) => ({ ok: false as const, error, ms: Math.round(performance.now() - agentStarted) }),
      );
    return { controller, promise, key: grantKey(grant) };
  };

  const preRules = decide(ruleSignals, initialFacts, sender, { agent: true });
  const preGate = guard(preRules, null);
  let attempt = preGate.view.final !== "escalate" ? startAgent(ruleSignals, initialFacts, preRules, preGate) : undefined;

  const stage = await settle();
  if (stage.locked.view.final === "escalate") {
    attempt?.controller.abort();
    heldText = [];
    return rulePath(stage, { input, deps, emit, started, classifierMs: stage.classifierMs });
  }
  const finalGrant = grantFor(stage.signals, stage.facts);
  if (!attempt || attempt.key !== grantKey(finalGrant)) {
    // The classifier changed what this conversation may read (e.g. a third-party claim): start over.
    attempt?.controller.abort();
    heldText = [];
    attempt = startAgent(stage.signals, stage.facts, stage.rules, stage.locked);
  }
  confirmed = true;
  for (const e of heldText) emit(e);
  heldText = [];

  const outcome = await attempt.promise;
  if (!outcome.ok) {
    const err = outcome.error;
    if (!(err instanceof AgentRejectedError)) throw err;
    if (err.ledger.changes.length) {
      emit({ type: "text-reset" });
      const run: AgentRunResult = { text: confirmChanges(err.ledger, stage.signals.language), decision: derivedDecision(err.ledger), ledger: err.ledger, view: err.view };
      return agentResult(stage, run, { started, classifierMs: stage.classifierMs, agentMs: outcome.ms });
    }
    // The rule path still answers with the AI phraser, so this works in pure-AI mode too.
    const busy = stage.locked.brief.kind === "open_question" && err.view.issues.length > 0 && err.view.issues.every((i) => i.check === "model_error");
    if (!busy && !deps.phraser && !(deps.allowFallback ?? false)) throw new Error(`${err.message}. Template fallback is disabled in settings.`);
    emit({ type: "text-reset" });
    return rulePath(stage, { input, deps, emit, started, classifierMs: stage.classifierMs, agentFailure: err, agentMs: outcome.ms, busy });
  }
  return agentResult(stage, outcome.run, {
    started,
    classifierMs: stage.classifierMs,
    agentMs: outcome.ms,
  });
}

function agentResult(stage: Stage, run: AgentRunResult, t: { started: number; classifierMs?: number; agentMs: number }): TriageResult {
  const { signals, facts, rules, locked, proposal, chips } = stage;
  const decision = STRICTNESS[run.decision] >= STRICTNESS[locked.view.final] ? run.decision : locked.view.final;
  const handoff = run.ledger.handoff
    ? { ...run.ledger.handoff, ...(rules.mood.upset || rules.mood.repeat ? { priority: "urgent" as const, queue: "Senior support", slaHours: OPS.urgentSlaHours } : {}) }
    : decision === "escalate"
      ? locked.handoff
      : undefined;
  const actions: Action[] = [
    ...run.ledger.actions,
    ...(handoff ? [{ kind: "handoff" as const, label: `Handed to ${handoff.queue}`, detail: `Priority ${handoff.priority} · reply due within ${handoff.slaHours}h` }] : []),
    ...(run.ledger.denied
      ? [{ kind: "withheld" as const, label: "Lookup refused", detail: run.ledger.traces.filter((x) => x.access === "denied").map((x) => x.summary).join("; ") }]
      : []),
  ];
  const opened = [...run.ledger.openedOrders.values()];
  const shown = opened.filter((o) => new RegExp(`(?<!\\d)${o.id}(?!\\d)`).test(run.text) || run.ledger.vouchers.some((v) => v.orderId === o.id));
  const withheld = [...rules.withheld, ...run.ledger.traces.filter((x) => x.access === "denied").map((x) => `Tool refused: ${x.summary}`)];
  return {
    id: crypto.randomUUID(),
    decision,
    reply: { text: run.text, language: signals.language },
    outcome: agentOutcome(run, decision),
    orders: shown.length ? shown.map((o) => formatOrderCard(o, facts.today)) : undefined,
    vouchers: run.ledger.vouchers.length ? run.ledger.vouchers : undefined,
    why: {
      summary: agentSummary(rules, locked, run),
      firedRule: { id: rules.fired, title: rules.checks.find((c) => c.id === rules.fired)!.title },
      checks: rules.checks,
      signals: chips,
      facts: rules.facts,
      proposal,
      guard: {
        ...locked.view,
        final: decision,
        note:
          STRICTNESS[decision] > STRICTNESS[locked.view.final]
            ? `${locked.view.note} The agent's tool calls then made it stricter (${decision.replaceAll("_", " ")}).`
            : locked.view.note,
      },
      actions,
      withheld: [...new Set(withheld)],
      handoff,
      phrasing: {
        engine: "agent",
        phraser: run.view.model,
        rejectedDraft: run.view.rejectedDraft,
        issues: run.view.issues,
        latencyMs: run.view.latencyMs,
      },
    },
    agent: run.view,
    intent: signals.intent.value,
    orderId: facts.order && run.ledger.openedOrders.has(facts.order.id) ? facts.order.id : opened[0]?.id,
    engines: { decision: proposal ? proposal.engine : "rules", phrasing: run.view.model, agent: run.view.model },
    timings: { totalMs: Math.round(performance.now() - t.started), classifierMs: t.classifierMs, agentMs: t.agentMs },
  };
}

/** 6b. Fixed rule path: approved draft, optionally rephrased. Also the fallback when the agent fails. */
async function rulePath(
  stage: Stage,
  ctx: {
    input: { text: string; sender: Sender };
    deps: PipelineDeps;
    emit: (e: ProgressEvent) => void;
    started: number;
    classifierMs?: number;
    agentFailure?: AgentRejectedError;
    agentMs?: number;
    busy?: boolean;
  },
): Promise<TriageResult> {
  const { signals, facts, rules, locked, proposal, chips } = stage;
  const { input, deps, emit, agentFailure } = ctx;
  const { sender, text } = input;

  let finalLock = locked;
  let summaryNote: string | undefined;
  if (agentFailure && ctx.busy) {
    finalLock = {
      ...locked,
      view: { ...locked.view, note: `${locked.view.note} The model provider was unavailable, so the customer was asked to send the message again.` },
      brief: { ...locked.brief, kind: "busy_retry", decision: "resolve", outcome: "Asked to resend" },
      handoff: undefined,
    };
  } else if (agentFailure && locked.brief.kind === "open_question") {
    // Nothing but the agent could answer this, so a person does.
    finalLock = {
      ...locked,
      view: { ...locked.view, final: "escalate", note: `${locked.view.note} The agent's answer failed the output checks, so a person takes over.` },
      brief: { ...locked.brief, kind: "escalate_no_policy", decision: "escalate", outcome: "Handed to a person" },
      handoff: {
        priority: rules.mood.upset || rules.mood.repeat ? "urgent" : "normal",
        queue: rules.mood.upset || rules.mood.repeat ? "Senior support" : "Support team",
        slaHours: rules.mood.upset || rules.mood.repeat ? OPS.urgentSlaHours : OPS.standardSlaHours,
        note: `${sender.displayName} (${sender.channel} ${sender.handle}) asked something the agent couldn't answer safely.`,
      },
    };
  }
  if (agentFailure) {
    summaryNote = `The agent's reply was blocked (${agentFailure.view.issues.map((i) => i.check).join(", ") || "model error"}), so the rule path's approved reply was sent instead.`;
  }

  const writing = finalLock.view.final === "escalate" ? "Passing you to a colleague" : "Writing the reply";
  emit({ type: "step", id: "phrase", label: writing, status: "active" });
  const phrasing = ctx.busy
    ? { text: renderDraft(finalLock.brief, signals.language), view: { engine: "template" as const, issues: [] } }
    : await phraseReply(finalLock.brief, signals.language, text, deps.phraser, deps.allowFallback ?? false);
  emit({ type: "step", id: "phrase", label: writing, status: "done" });

  let orders: OrderCardData[] | undefined;
  const isVerified = Boolean(facts.identity?.verified || (sender.customerId && !signals.thirdParty.hit));
  if (finalLock.view.final === "resolve" && isVerified && ORDER_BRIEFS.includes(finalLock.brief.kind)) {
    if (finalLock.brief.kind === "orders_list") {
      orders = facts.senderOrders.map((o) => formatOrderCard(o, facts.today));
    } else if (facts.order && facts.identity?.verified) {
      orders = [formatOrderCard(facts.order, facts.today)];
    }
  }

  const handoff = finalLock.handoff;
  const baseActions =
    finalLock.handoff && !rules.handoff
      ? [
          ...rules.actions,
          {
            kind: "handoff" as const,
            label: `Handed to ${finalLock.handoff.queue}`,
            detail: `Priority ${finalLock.handoff.priority} · reply due within ${finalLock.handoff.slaHours}h`,
          },
        ]
      : rules.actions;

  const failedView: AgentView | undefined = agentFailure?.view;
  return {
    id: crypto.randomUUID(),
    decision: finalLock.view.final,
    reply: { text: phrasing.text, language: signals.language },
    outcome: finalLock.brief.outcome,
    orders,
    why: {
      summary: [rules.summary, finalLock.summarySuffix ?? locked.summarySuffix, summaryNote].filter(Boolean).join(" "),
      firedRule: { id: rules.fired, title: rules.checks.find((c) => c.id === rules.fired)!.title },
      checks: rules.checks,
      signals: chips,
      facts: rules.facts,
      proposal,
      guard: finalLock.view,
      actions: baseActions,
      withheld: rules.withheld,
      handoff,
      phrasing: failedView ? { ...phrasing.view, rejectedDraft: failedView.rejectedDraft, issues: [...failedView.issues, ...phrasing.view.issues] } : phrasing.view,
    },
    agent: failedView,
    intent: signals.intent.value,
    orderId: facts.order?.id,
    engines: {
      decision: proposal ? proposal.engine : "rules",
      phrasing: deps.phraser?.name ?? "templates",
      agent: deps.agent?.name,
    },
    timings: { totalMs: Math.round(performance.now() - ctx.started), classifierMs: ctx.classifierMs, agentMs: ctx.agentMs },
  };
}
