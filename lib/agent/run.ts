import { isStepCount, streamText, type ModelMessage } from "ai";
import { safeModelError } from "@/lib/engine/errors";
import {
  strictest,
  type AgentView,
  type Decision,
  type Language,
  type ProgressEvent,
  type ThreadMessage,
  type ValidationIssue,
} from "@/lib/engine/types";
import type { AccessGrant } from "./access";
import { ToolLedger } from "./ledger";
import type { AgentModel } from "./models";
import { buildInstructions, type CustomerMood } from "./prompt";
import { createSupportTools } from "./tools";
import { ordersOfCustomer, findCustomer, vouchersForOrders } from "@/lib/db/repo";
import { orderSummary, compensationGiven } from "./views";
import { validateAgentReply } from "./validate";

/*
 * The agent loop:
 *
 *   instructions (skills + session facts + policy)
 *     → model ⇄ tools (scoped to the AccessGrant, every call recorded in the ledger)
 *     → reply, streamed sentence by sentence — each sentence is checked before it's shown
 *     → output checks on the whole reply (validate.ts)
 *     → one repair round if a check fails, then give up
 *
 * The decision is derived from what the tools recorded, not from the text:
 * a handoff tool call means "escalate", any refused lookup means
 * "request_verification", and neither can be undone by what the model writes.
 */

const MAX_STEPS = 4;
const HISTORY_EXCHANGES = 4;
/** Hard budget for the whole agent run; after it the rule path answers instead. */
const AGENT_BUDGET_MS = Number(process.env.AGENT_TIMEOUT_MS) || 18_000;

export interface AgentRunInput {
  text: string;
  thread: ThreadMessage[];
  grant: AccessGrant;
  language: Language;
  /** Decision the intake checks (rules + guard) already locked. The agent can only make it stricter. */
  gate: Decision;
  mood?: CustomerMood;
  /** Every email, phone and address the shop holds, for the leak check. */
  protectedValues: string[];
}

export interface AgentRunOptions {
  onEvent?: (e: ProgressEvent) => void;
  /** Cancels the run (e.g. the intake checks decided a person must take over after all). */
  signal?: AbortSignal;
  /** Time budget for this run (defaults to AGENT_TIMEOUT_MS or 18 s). */
  budgetMs?: number;
}

const AFTER_TOOL: Record<string, string> = {
  preload: "Reviewing your account and orders",
  get_my_account: "Reviewing your profile",
  list_my_orders: "Going through your orders",
  get_order: "Reviewing the order details",
  search_products: "Comparing products and stock",
  open_carrier_trace: "Reviewing the courier's answer",
  issue_delay_voucher: "Checking your compensation",
  change_delivery_address: "Confirming the change against your order",
  remove_order_item: "Confirming the change against your order",
  cancel_order: "Confirming the cancellation",
  request_human: "Preparing the note for my colleague",
};

function nextStepLabel(ledger: ToolLedger): string {
  const last = ledger.traces.at(-1);
  if (!last) return "Understanding your question";
  if (last.access === "denied") return "Checking what I'm allowed to share";
  if (last.access === "refused") return "Checking what's possible here";
  if (last.access === "error") return "Working around a failed lookup";
  return AFTER_TOOL[last.tool] ?? "Evaluating what I found";
}

export interface AgentRunResult {
  text: string;
  decision: Decision;
  ledger: ToolLedger;
  view: AgentView;
}

export class AgentRejectedError extends Error {
  constructor(
    message: string,
    readonly view: AgentView,
    readonly ledger: ToolLedger,
  ) {
    super(message);
    this.name = "AgentRejectedError";
  }
}

/** Earlier turns from THIS sender only; another sender's replies never enter the context. */
function history(thread: ThreadMessage[], senderId: string): ModelMessage[] {
  const mine = thread.filter((m) => m.senderId === senderId).slice(-HISTORY_EXCHANGES);
  return mine.flatMap((m): ModelMessage[] => [
    { role: "user", content: m.text },
    ...(m.reply ? [{ role: "assistant" as const, content: m.reply.slice(0, 400) }] : []),
  ]);
}

export function derivedDecision(ledger: ToolLedger): Decision {
  if (ledger.handoff) return "escalate";
  if (ledger.denied > 0) return "request_verification";
  return "resolve";
}

/** Short capitalised words before a dot are abbreviations ("Rr.", "Nr.", "St."), not sentence ends. */
const ABBREVIATION = /(?:^|[\s(])[A-ZËÇ][a-zëç]{0,2}\.$/;

/** Complete sentences at the start of `text` (ending in . ! ? … or a newline, followed by space). */
function completeSentences(text: string): number {
  let end = 0;
  const re = /[.!?…]+["”’)]*\s+|\n+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = text.slice(0, m.index + m[0].trimEnd().length);
    if (ABBREVIATION.test(before)) continue;
    end = m.index + m[0].length;
  }
  return end;
}

let runSeq = 0;

/**
 * Run the agent on its model; if that model can't be reached at all (outage,
 * rate limit, timeout), run once more on `agent.fallback`. The two budgets add
 * up to the overall AGENT_TIMEOUT_MS. A reply that fails the output checks is
 * not retried on the fallback: that's a content problem, not an outage.
 */
export async function runAgent(input: AgentRunInput, agent: AgentModel, opts: AgentRunOptions = {}): Promise<AgentRunResult> {
  if (!agent.fallback) return runAgentOnce(input, agent, opts);
  const total = opts.budgetMs ?? AGENT_BUDGET_MS;
  const started = performance.now();
  try {
    return await runAgentOnce(input, agent, { ...opts, budgetMs: Math.round(total * 0.55) });
  } catch (err) {
    const unreachable = err instanceof AgentRejectedError && err.view.issues.some((i) => i.check === "model_error");
    const left = total - (performance.now() - started);
    if (!unreachable || (err.ledger.changes.length > 0 || err.ledger.vouchers.length > 0) || opts.signal?.aborted || left < 4000) throw err;
    opts.onEvent?.({ type: "text-reset" });
    return runAgentOnce(input, agent.fallback, { ...opts, budgetMs: Math.round(left) });
  }
}

async function runAgentOnce(input: AgentRunInput, agent: AgentModel, opts: AgentRunOptions = {}): Promise<AgentRunResult> {
  const started = performance.now();
  const emit = opts.onEvent ?? (() => {});
  const run = ++runSeq;
  const { grant } = input;
  const ledger = new ToolLedger(opts.onEvent);
  const customerTexts = [...input.thread.filter((m) => m.senderId === grant.sender.id).map((m) => m.text), input.text];
  const tools = createSupportTools(grant, ledger, customerTexts);
  // Preload the writer's own orders: most questions then need one model call and no tools.
  let snapshot: unknown;
  if (grant.accountId) {
    const [customer, orders] = await Promise.all([findCustomer(grant.accountId), ordersOfCustomer(grant.accountId)]);
    const given = await vouchersForOrders(orders.map((o) => o.id));
    snapshot = { name: customer?.name, orders: orders.map((o) => ({ ...orderSummary(o, grant.today, grant.policies), ...compensationGiven(given.get(o.id)) })) };
    for (const o of orders) ledger.openedOrders.set(o.id, o);
    ledger.record({ tool: "preload", input: {}, access: "granted", summary: `Own account snapshot (${orders.length} orders)`, latencyMs: 0 }, snapshot);
  }
  const instructions = buildInstructions({ grant, language: input.language, gate: input.gate, mood: input.mood, snapshot });
  const deadline = started + (opts.budgetMs ?? AGENT_BUDGET_MS);
  const messages: ModelMessage[] = [...history(input.thread, grant.sender.id), { role: "user", content: input.text }];
  const check = (reply: string, partial = false) =>
    validateAgentReply(reply, {
      ledger,
      language: input.language,
      customerTexts,
      policies: grant.policies,
      protectedValues: input.protectedValues,
      partial,
    });

  let steps = 0;
  const view = (extra: Partial<AgentView> = {}): AgentView => ({
    model: agent.name,
    scope: { level: grant.level, note: grant.note },
    toolCalls: ledger.traces,
    steps,
    latencyMs: Math.round(performance.now() - started),
    repaired: false,
    issues: [],
    ...extra,
  });

  /**
   * One model call (up to `maxSteps` tool rounds). Text is streamed out only in
   * whole sentences that pass the checks; the first sentence that doesn't stops
   * the stream for this call. Returns the final step's text and what was shown.
   */
  let thinkSeq = 0;
  const call = async (msgs: ModelMessage[], maxSteps: number, label: string) => {
    let thinkId: string | undefined;
    let thinkLabel = "";
    let rounds = 0;
    const stopThinking = (status: "done" | "failed" = "done") => {
      if (thinkId) emit({ type: "step", id: thinkId, label: thinkLabel, status });
      thinkId = undefined;
    };
    const startThinking = (next: string) => {
      stopThinking();
      thinkId = `think-${run}-${++thinkSeq}`;
      thinkLabel = next;
      emit({ type: "step", id: thinkId, label: next, status: "active" });
    };

    const timeLimit = AbortSignal.timeout(Math.max(1000, Math.round(deadline - performance.now())));
    const abortSignal = opts.signal ? AbortSignal.any([opts.signal, timeLimit]) : timeLimit;
    const result = streamText({
      model: agent.model,
      instructions,
      messages: msgs,
      tools,
      stopWhen: isStepCount(maxSteps),
      temperature: 0.3,
      maxOutputTokens: 1500,
      // One quick retry at most: a rate-limit wait of 30s+ is worse than answering from the rule path.
      maxRetries: agent.simulated ? 0 : 1,
      abortSignal,
      providerOptions: agent.providerOptions,
    });

    let stepText = "";
    let lastText = ""; // last non-empty step text (some models answer next to a tool call, then stop silently)
    let shown = 0; // chars of stepText already streamed out
    let blocked = false;
    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "start-step":
            startThinking(rounds++ === 0 ? label : nextStepLabel(ledger));
            if (stepText.trim()) lastText = stepText;
            stepText = "";
            shown = 0;
            blocked = false;
            break;
          case "tool-call":
            stopThinking();
            break;
          case "text-delta": {
            stopThinking();
            stepText += part.text;
            if (blocked) break;
            const end = completeSentences(stepText);
            if (end > shown) {
              // Check everything shown so far plus the new sentence, so nothing slips
              // through by being split across two sentences.
              if (check(stepText.slice(0, end), true).length) blocked = true;
              else {
                emit({ type: "text", delta: stepText.slice(shown, end) });
                shown = end;
              }
            }
            break;
          }
          case "finish-step":
            steps += 1;
            // Text before a tool call was a preamble ("let me check…"), not the reply.
            if (part.finishReason === "tool-calls" && shown > 0) {
              emit({ type: "text-reset" });
              shown = 0;
            }
            break;
          case "error":
            throw part.error;
        }
      }
      if (abortSignal.aborted) throw abortSignal.reason ?? new Error("The model ran out of time");
    } catch (err) {
      stopThinking("failed");
      throw err;
    }
    stopThinking();
    if (!stepText.trim() && lastText.trim()) {
      stepText = lastText;
      shown = 0;
    }
    return { text: stepText.trim(), shownRaw: stepText.slice(0, shown), stepText, responseMessages: await result.responseMessages };
  };

  const finish = (stepText: string, shownRaw: string) => {
    const tail = stepText.slice(shownRaw.length);
    if (tail.trim()) emit({ type: "text", delta: tail });
  };

  const checkId = `check-${run}`;
  const checkLabel = "Double-checking the reply";

  let first;
  try {
    first = await call(messages, MAX_STEPS, nextStepLabel(ledger));
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    console.error("[agent] model call failed", err);
    const detail = safeModelError(err, "Agent model failed");
    throw new AgentRejectedError(detail, view({ issues: [{ check: "model_error", detail }] }), ledger);
  }

  const draft = first.text;
  const issues = draft ? check(draft) : [{ check: "length", detail: "The agent stopped without writing a reply" } satisfies ValidationIssue];
  if (!issues.length) {
    finish(first.stepText, first.shownRaw);
    return { text: draft, decision: strictest(input.gate, derivedDecision(ledger)), ledger, view: view() };
  }

  // One repair round, if there's time: the model sees why its reply was blocked.
  emit({ type: "text-reset" });
  if (deadline - performance.now() < 5000) {
    throw new AgentRejectedError(`The agent's reply failed the output checks: ${issues.map((i) => i.detail).join("; ")}`, view({ rejectedDraft: draft || undefined, issues }), ledger);
  }
  emit({ type: "step", id: checkId, label: checkLabel, status: "active" });
  const note = [
    "[Automatic output check — this note is not from the customer and must not be mentioned.]",
    "Your reply was not sent because:",
    ...issues.map((i) => `- ${i.detail}`),
    "Write the reply again. Use only facts from tool results and the written policy, share nothing from denied lookups, and promise nothing the records don't support.",
  ].join("\n");
  let second;
  try {
    second = await call([...messages, ...first.responseMessages, { role: "user", content: note }], 3, "Rewriting the reply");
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    console.error("[agent] model call failed (repair round)", err);
    emit({ type: "step", id: checkId, label: checkLabel, status: "failed" });
    throw new AgentRejectedError(safeModelError(err, "Agent model failed"), view({ rejectedDraft: draft || undefined, issues }), ledger);
  }
  const retry = second.text;
  const retryIssues = retry ? check(retry) : [{ check: "length", detail: "The agent stopped without writing a reply" } satisfies ValidationIssue];
  if (retryIssues.length) {
    emit({ type: "text-reset" });
    emit({ type: "step", id: checkId, label: checkLabel, status: "failed" });
    throw new AgentRejectedError(
      `The agent's reply failed the output checks twice: ${retryIssues.map((i) => i.detail).join("; ")}`,
      view({ rejectedDraft: draft || retry || undefined, issues: [...new Map([...issues, ...retryIssues].map((i) => [`${i.check}|${i.detail}`, i])).values()] }),
      ledger,
    );
  }
  emit({ type: "step", id: checkId, label: checkLabel, status: "done" });
  finish(second.stepText, second.shownRaw);
  return {
    text: retry,
    decision: strictest(input.gate, derivedDecision(ledger)),
    ledger,
    view: view({ repaired: true, rejectedDraft: draft || undefined, issues }),
  };
}
