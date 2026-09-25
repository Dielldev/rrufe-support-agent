"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import type { EngineStatus } from "@/lib/engine/config";
import type { Decision, RuleId, Sender, TriageResult } from "@/lib/engine/types";
import type { Scenario } from "@/lib/scenarios";
import { DECISION_STYLE, DecisionPill } from "../console/ui";
import {
  ChannelIcon,
  CheckIcon,
  CodeIcon,
  DatabaseIcon,
  InboxIcon,
  ShieldIcon,
  SparkIcon,
  XIcon,
} from "../icons";

export interface ScenarioTrace {
  scenario: Scenario;
  sender: Sender;
  /** Deterministic path: rules only, approved templates. */
  standard: TriageResult;
  /** Overconfident decision model + rogue agent + rogue phraser. */
  stress: TriageResult;
}

type Owner = "channel" | "code" | "records" | "jev" | "llm";

const OWNER: Record<Owner, { label: string; cls: string; icon: ComponentType<{ size?: number }> }> = {
  channel: { label: "Inbox", cls: "bg-sunken text-ink-2", icon: InboxIcon },
  code: { label: "Deterministic code", cls: "bg-sunken text-ink-2", icon: CodeIcon },
  records: { label: "Code + mock records", cls: "bg-sunken text-ink-2", icon: DatabaseIcon },
  jev: { label: "Jev or Groq · typed proposal", cls: "bg-sunken text-ink-2", icon: SparkIcon },
  llm: { label: "LLM · wording only", cls: "bg-sunken text-ink-2", icon: SparkIcon },
};

const DECISION_ORDER: Decision[] = ["resolve", "request_verification", "escalate"];
const STROKE: Record<Decision, string> = { resolve: "stroke-ink", request_verification: "stroke-ink", escalate: "stroke-ink" };

export function FlowExplorer({
  traces,
  rules,
  status,
}: {
  traces: ScenarioTrace[];
  rules: Record<RuleId, { title: string; decision: Decision; description: string }>;
  status: EngineStatus;
}) {
  const [selected, setSelected] = useState<string | null>(traces[0]?.scenario.id ?? null);
  const trace = traces.find((t) => t.scenario.id === selected);
  const t = trace?.standard;
  const s = trace?.stress;
  const chosen = t?.decision;

  return (
    <main className="mx-auto grid max-w-[1320px] grid-cols-1 gap-8 px-4 pt-4 pb-12 sm:px-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0">
        <header className="mb-6 max-w-2xl">
          <h1 className="text-xl font-semibold tracking-tight">How a message becomes a reply</h1>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Code owns the facts and the decision. The model (Jev, or Groq until Jev is set up) may only <em>propose</em>, and only toward caution. A language model
            touches the reply after the decision is locked, and only to word it.
          </p>
        </header>

        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted">Trace a test message:</span>
          {traces.map((tr, i) => {
            const active = tr.scenario.id === selected;
            const st = DECISION_STYLE[tr.standard.decision];
            return (
              <button
                key={tr.scenario.id}
                type="button"
                onClick={() => setSelected(tr.scenario.id)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  active ? `${st.bg} ${st.line} ${st.text} shadow-sm` : "border-line bg-surface text-ink-2 hover:border-line-strong"
                }`}
              >
                <span className="font-mono text-[10.5px] opacity-70">0{i + 1}</span>
                {tr.scenario.title}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setSelected(null)}
            aria-pressed={selected === null}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              selected === null ? "border-ink bg-ink text-white" : "border-line bg-surface text-muted hover:text-ink"
            }`}
          >
            All paths
          </button>
        </div>

        <div className="mx-auto max-w-3xl">
          <FlowNode step="1" title="Message arrives" owner="channel" body="Email, Instagram DM or Viber — in Albanian or English. The channel supplies the sender's verified email or phone number.">
            {trace && t && (
              <Note decision={chosen}>
                <div className="mb-1 flex items-center gap-1.5 text-muted">
                  <ChannelIcon channel={trace.sender.channel} size={12} /> {trace.sender.displayName} · {trace.sender.handle}
                </div>
                <p className="text-[13px] font-medium text-ink">“{trace.scenario.text}”</p>
              </Note>
            )}
          </FlowNode>
          <Down />
          <FlowNode
            step="2"
            title="Read signals"
            owner="code"
            body="Language, order numbers, stated contacts, anger and repeat-contact markers, third-party claims, personal-data asks, topics with no written policy. Every signal keeps the exact words that triggered it."
          >
            {t && (
              <Note decision={chosen}>
                <div className="flex flex-wrap gap-1">
                  {t.why.signals.map((c) => (
                    <span
                      key={c.label}
                      className={`rounded px-1.5 py-0.5 ${c.tone === "bad" ? "bg-surface font-medium text-ink ring-1 ring-line-strong" : "bg-surface text-ink-2 ring-1 ring-line"}`}
                    >
                      {c.label}: <span className="font-medium">{c.value}</span>
                    </span>
                  ))}
                </div>
              </Note>
            )}
          </FlowNode>
          <Down />
          <FlowNode
            step="3"
            title="Look up facts"
            owner="records"
            body="Order status, days elapsed, delivery and return windows, whether the sender matches the buyer on record, earlier contacts, and whether a written policy covers the topic."
          >
            {t && (
              <Note decision={chosen}>
                <ul className="space-y-0.5">
                  {t.why.facts
                    .filter((f) => f.label !== "Channel identity")
                    .slice(0, 5)
                    .map((f) => (
                      <li key={f.label}>
                        <span className="text-muted">{f.label}:</span>{" "}
                        <span className={f.tone === "bad" ? "font-medium text-ink" : "text-ink-2"}>{f.value}</span>
                      </li>
                    ))}
                </ul>
              </Note>
            )}
          </FlowNode>

          <Split />
          <div className="grid gap-4 sm:grid-cols-2">
            <FlowNode
              step="4a"
              title="Rules decide"
              owner="code"
              body="R1 → R6 in fixed precedence. The strictest rule that fires sets the floor."
            >
              {t && (
                <Note decision={chosen}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono font-semibold">{t.why.firedRule.id}</span>
                    <span>{t.why.firedRule.title}</span>
                  </div>
                  <div className="mt-1.5">
                    <DecisionPill decision={t.why.guard.rulesDecision} size="sm" />
                  </div>
                </Note>
              )}
            </FlowNode>
            <FlowNode
              step="4b"
              title="Model proposes"
              owner="jev"
              body="Jev when an AI Gateway key is set, otherwise Groq. Either way: a choice from the same three options plus risk flags with probabilities. No free text, no personal data in its input."
            >
              {s && (
                <Note decision={chosen}>
                  <p className="text-muted">
                    {status.decision.live ? `Live: ${status.decision.label}.` : "No model key configured, so rules decide alone."}
                  </p>
                  <p className="mt-1">
                    Stress test: a model saying{" "}
                    <span className="font-semibold">resolve at {Math.round((s.why.proposal?.decision?.probability ?? 0) * 100)}%</span> →{" "}
                    <span className={s.why.guard.outcome === "overridden" ? "font-semibold text-bad" : "font-semibold text-dot-ok"}>
                      {s.why.guard.outcome === "overridden" ? "overridden" : "agreed"}
                    </span>
                  </p>
                </Note>
              )}
            </FlowNode>
          </div>
          <Merge />

          <FlowNode
            step="5"
            title="Guard locks the decision"
            owner="code"
            body="A model may make the decision stricter, never looser. If the model is unsure (< 50%) or disagrees about the topic, a human looks. Confidence never overrides a fact."
            icon={ShieldIcon}
          >
            {t && s && (
              <Note decision={chosen}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">Locked:</span> <DecisionPill decision={t.decision} size="sm" />
                  <span className="text-muted">· stress test locked:</span> <DecisionPill decision={s.decision} size="sm" />
                </div>
                {s.why.guard.outcome === "overridden" && <p className="mt-1.5 text-bad">{s.why.guard.note}</p>}
              </Note>
            )}
          </FlowNode>

          <Split3 chosen={chosen} />
          <div className="grid gap-3 sm:grid-cols-3">
            {DECISION_ORDER.map((d) => {
              const st = DECISION_STYLE[d];
              const landed = traces.filter((tr) => tr.standard.decision === d);
              const isChosen = chosen === d;
              return (
                <div
                  key={d}
                  className={`rounded-xl border p-3 transition ${st.line} ${st.bg} ${
                    chosen && !isChosen ? "opacity-35 saturate-50" : ""
                  } ${isChosen ? "shadow-md ring-2 " + st.ring : ""}`}
                >
                  <DecisionPill decision={d} />
                  <p className="mt-2 text-xs leading-snug text-ink-2">{st.blurb}</p>
                  <ul className="mt-2 space-y-0.5">
                    {landed.map((tr) => (
                      <li key={tr.scenario.id} className={`text-[11px] ${st.text}`}>
                        · {tr.scenario.title}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <Merge3 chosen={chosen} />

          <FlowNode
            step="6"
            title="Agent answers with scoped tools"
            owner="llm"
            body="Unless a person took over, the agent writes the reply. Its tools are built around the sender's inbox identity: their own orders and profile, the public catalog, a carrier trace and a handoff. No tool takes a customer id, and every order lookup re-checks ownership. Without an agent model, the rule's approved draft is rephrased instead."
          >
            {t && s && (
              <Note decision={chosen}>
                <p className="text-muted">
                  Here: {status.agent.live ? `agent ${status.agent.label}` : status.phrasing.live ? `no agent; phrased by ${status.phrasing.label}` : "no model configured, so the approved template is sent"} ·{" "}
                  {t.reply.language === "sq" ? "Albanian" : "English"}
                </p>
                {s.agent ? (
                  <>
                    <p className="mt-1.5 text-muted">Stress test — the rogue agent tried:</p>
                    <ul className="space-y-0.5">
                      {s.agent.toolCalls.map((c, i) => (
                        <li key={i} className={c.access === "denied" ? "text-bad" : "text-ink-2"}>
                          <span className="font-mono">{c.tool}</span> — {c.summary} ({c.access})
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  s.why.phrasing.rejectedDraft && (
                    <p className="mt-1.5">
                      Stress test draft: <span className="text-bad">“{s.why.phrasing.rejectedDraft}”</span>
                    </p>
                  )
                )}
              </Note>
            )}
          </FlowNode>
          <Down />
          <FlowNode
            step="7"
            title="Validate before sending"
            owner="code"
            body="Blocks anyone else's personal data (every address, email and phone the shop holds is checked), numbers that no tool result or policy contains, new promises (refunds, discounts…), talk about internals, or the wrong language. The agent gets one rewrite; after that the approved template goes out instead."
            icon={ShieldIcon}
          >
            {s && (
              <Note decision={chosen}>
                <p className="mb-1 text-muted">Caught in the stress-test draft:</p>
                <ul className="space-y-0.5">
                  {s.why.phrasing.issues.map((i) => (
                    <li key={i.check + i.detail} className="flex items-start gap-1 text-bad">
                      <XIcon size={11} strokeWidth={2.6} className="mt-0.5 shrink-0" />
                      <span>
                        <span className="font-mono">{i.check}</span> — {i.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </Note>
            )}
          </FlowNode>
          <Down />
          <FlowNode step="8" title="Reply sent + actions logged" owner="channel" body="Carrier traces, human handoffs with a note for staff, and withheld data are recorded next to the reply.">
            {t && (
              <Note decision={chosen}>
                <p className="text-[13px] leading-relaxed text-ink">{t.reply.text}</p>
                {t.why.actions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.why.actions.map((a) => (
                      <span key={a.label} className="rounded bg-surface px-1.5 py-0.5 text-ink-2 ring-1 ring-line">
                        {a.label}
                      </span>
                    ))}
                  </div>
                )}
              </Note>
            )}
          </FlowNode>
        </div>
      </section>

      <aside className="space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-8rem)] xl:self-start xl:overflow-y-auto scroll-soft">
        <Card title="Test run — rendered on every page load">
          <table className="w-full text-left text-xs">
            <thead className="text-[10.5px] tracking-wide text-faint uppercase">
              <tr>
                <th className="pb-1.5 font-semibold">Message</th>
                <th className="pb-1.5 font-semibold">Expected</th>
                <th className="pb-1.5 text-center font-semibold">Rules</th>
                <th className="pb-1.5 text-center font-semibold">Stress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {traces.map((tr, i) => (
                <tr key={tr.scenario.id}>
                  <td className="py-1.5 pr-2">
                    <span className="font-mono text-faint">0{i + 1}</span> {tr.scenario.title}
                  </td>
                  <td className="py-1.5">
                    <DecisionPill decision={tr.scenario.expected} size="sm" />
                  </td>
                  <td className="py-1.5 text-center">
                    <Tick ok={tr.standard.decision === tr.scenario.expected} />
                  </td>
                  <td className="py-1.5 text-center">
                    <Tick ok={tr.stress.decision === tr.scenario.expected} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-snug text-muted">
            “Stress” swaps in a model that always proposes resolve at 99% and a phraser that tries to promise, invent and leak.
          </p>
        </Card>

        <Card title="Hard rules, in precedence order">
          <ol className="space-y-2.5">
            {(Object.keys(rules) as RuleId[]).map((id) => {
              const r = rules[id];
              const fired = t?.why.firedRule.id === id;
              return (
                <li key={id} className={`grid grid-cols-[26px_1fr] gap-2 rounded-lg p-1.5 ${fired ? `${DECISION_STYLE[r.decision].bg} ring-1 ${DECISION_STYLE[r.decision].ring}` : ""}`}>
                  <span className="pt-0.5 font-mono text-xs font-semibold text-faint">{id}</span>
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-semibold">{r.title}</span>
                      <DecisionPill decision={r.decision} size="sm" />
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-muted">{r.description}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>

        <Card title="What the models can and can't do">
          <Boundary
            who="Jev / Groq — decision model"
            can={["Pick one of resolve / verify / escalate, with a probability", "Raise risk flags: anger, repeat contact, third party, data request"]}
            cannot={["Loosen a decision or clear a flag — strictest wins", "See names, addresses, phones or emails (its input is PII-free)"]}
          />
          <div className="my-3 border-t border-line" />
          <Boundary
            who="LLM — phrasing only"
            can={["Reword the approved draft in Albanian or English"]}
            cannot={["See the order record", "Add numbers, promises or personal data, or change the stance — the validator rejects it and the template is sent"]}
          />
        </Card>

      </aside>
    </main>
  );
}

function FlowNode({
  step,
  title,
  owner,
  body,
  children,
  icon,
}: {
  step: string;
  title: string;
  owner: Owner;
  body: string;
  children?: ReactNode;
  icon?: ComponentType<{ size?: number }>;
}) {
  const o = OWNER[owner];
  const Icon = icon ?? o.icon;
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5 shadow-[0_1px_0_rgba(20,23,31,0.03)]">
      <div className="flex items-start gap-3">
        <div className={`grid size-8 shrink-0 place-items-center rounded-lg ${o.cls}`}>
          <Icon size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[11px] font-semibold text-faint">{step}</span>
            <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
            <span className={`rounded px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase ${o.cls}`}>{o.label}</span>
          </div>
          <p className="mt-1 text-[13px] leading-snug text-muted">{body}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function Note({ decision, children }: { decision?: Decision; children: ReactNode }) {
  const st = decision ? DECISION_STYLE[decision] : undefined;
  return (
    <div className={`mt-2.5 animate-rise rounded-lg border-l-2 bg-sunken px-3 py-2 text-xs text-ink-2 ${st ? st.line : "border-line"}`}>
      {children}
    </div>
  );
}

function Down() {
  return (
    <div className="flex justify-center py-1" aria-hidden="true">
      <svg width="12" height="22" viewBox="0 0 12 22" className="text-line-strong">
        <path d="M6 0v18M1.5 14 6 19l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function Split() {
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-7 w-full text-line-strong" aria-hidden="true">
      <path d="M50 0 C50 6 25 4 25 10 M50 0 C50 6 75 4 75 10" fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Merge() {
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-7 w-full text-line-strong" aria-hidden="true">
      <path d="M25 0 C25 6 50 4 50 10 M75 0 C75 6 50 4 50 10" fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const X3: Record<Decision, number> = { resolve: 16.4, request_verification: 50, escalate: 83.6 };

function Split3({ chosen }: { chosen?: Decision }) {
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-8 w-full" aria-hidden="true">
      {DECISION_ORDER.map((d) => (
        <path
          key={d}
          d={`M50 0 C50 6 ${X3[d]} 4 ${X3[d]} 10`}
          fill="none"
          strokeWidth={chosen === d ? 2.4 : 1.6}
          vectorEffect="non-scaling-stroke"
          className={chosen === d ? STROKE[d] : "stroke-line-strong"}
        />
      ))}
    </svg>
  );
}

function Merge3({ chosen }: { chosen?: Decision }) {
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-8 w-full" aria-hidden="true">
      {DECISION_ORDER.map((d) => (
        <path
          key={d}
          d={`M${X3[d]} 0 C${X3[d]} 6 50 4 50 10`}
          fill="none"
          strokeWidth={chosen === d ? 2.4 : 1.6}
          vectorEffect="non-scaling-stroke"
          className={chosen === d ? STROKE[d] : "stroke-line-strong"}
        />
      ))}
    </svg>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-3 text-[13px] font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Boundary({ who, can, cannot }: { who: string; can: string[]; cannot: string[] }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold text-ink">{who}</h3>
      <ul className="space-y-1">
        {can.map((c) => (
          <li key={c} className="flex items-start gap-1.5 text-xs text-ink-2">
            <CheckIcon size={12} strokeWidth={2.6} className="mt-0.5 shrink-0 text-dot-ok" /> {c}
          </li>
        ))}
        {cannot.map((c) => (
          <li key={c} className="flex items-start gap-1.5 text-xs text-ink-2">
            <XIcon size={12} strokeWidth={2.6} className="mt-0.5 shrink-0 text-bad" /> {c}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tick({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckIcon size={14} strokeWidth={2.8} className="inline text-dot-ok" />
  ) : (
    <XIcon size={14} strokeWidth={2.8} className="inline text-bad" />
  );
}
