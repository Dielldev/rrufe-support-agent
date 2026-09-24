"use client";

import { useId, useState, type ReactNode } from "react";
import type { ProposalView, RunMode, Sender, TriageResult } from "@/lib/engine/types";
import { DECISION_STYLE, DecisionDot } from "../console/ui";
import { BotIcon, ChannelIcon, ChevronIcon } from "../icons";

const CHANNEL = { email: "Email", instagram: "Instagram", viber: "Viber" } as const;
const pct = (p: number) => `${Math.round(p * 100)}%`;
const human = (s: string) => s.replaceAll("_", " ");

const SOURCE_LABEL: Record<string, string> = {
  orders: "orders",
  contact_log: "contact log",
  policy: "policy",
  computed: "computed",
  customer: "customer's claim",
  channel: "channel",
  rules: "rules",
  jev: "model",
  "rules+jev": "rules + model",
};

export function UserMessage({ text, sender }: { text: string; sender: Sender }) {
  return (
    <div className="flex animate-rise flex-col items-end">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-faint">
        <ChannelIcon channel={sender.channel} size={12} />
        <span className="text-muted">{sender.displayName}</span>
        <span>
          · {CHANNEL[sender.channel]} {sender.handle}
        </span>
      </div>
      <div className="max-w-[85%] rounded-2xl bg-sunken px-4 py-2.5 text-[14.5px] leading-relaxed text-ink sm:max-w-[75%]">{text}</div>
    </div>
  );
}

function AgentAvatar() {
  return (
    <div className="grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-surface text-ink-2">
      <BotIcon size={14} />
    </div>
  );
}

export function TypingMessage() {
  return (
    <div className="flex animate-rise items-center gap-3">
      <AgentAvatar />
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-blink rounded-full bg-faint" style={{ animationDelay: `${i * 160}ms` }} />
        ))}
      </div>
    </div>
  );
}

export function ErrorMessage({ error }: { error: string }) {
  return (
    <div className="flex items-start gap-3">
      <AgentAvatar />
      <p className="pt-1 text-sm text-bad">{error}</p>
    </div>
  );
}

export function AgentMessage({ result, mode }: { result: TriageResult; mode: RunMode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const s = DECISION_STYLE[result.decision];

  return (
    <div className="flex animate-rise gap-3">
      <AgentAvatar />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-0.5 text-[13px]">
          <span className="font-semibold text-ink">Rrufe Support</span>
          <span className="text-faint">·</span>
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <DecisionDot decision={result.decision} />
            {s.label}
          </span>
          <span className="text-faint">· {result.outcome}</span>
          {result.why.phrasing.engine === "model" && (
            <span className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-2 shadow-xs">
              ⚡ {result.why.phrasing.phraser?.replace("groq/", "")} ({result.why.phrasing.latencyMs ?? result.timings.totalMs}ms)
            </span>
          )}
          {mode === "stress" && <span className="text-faint">· stress test</span>}
        </div>

        <p className="mt-1.5 text-[14.5px] leading-7 text-ink">{result.reply.text}</p>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            className="-ml-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-ink-2 hover:bg-hover"
          >
            Why?
            <ChevronIcon size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          <span>
            {result.why.firedRule.id} · {result.why.firedRule.title}
          </span>
          {result.why.actions.map((a) => (
            <span key={a.label} title={a.detail}>
              · {a.label}
            </span>
          ))}
        </div>

        {open && (
          <div id={panelId} className="mt-3 animate-rise">
            <WhyPanel result={result} />
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-[11px] font-medium tracking-wide text-faint uppercase">{title}</h4>
      {children}
    </section>
  );
}

function Row({ label, value, meta, strong }: { label: string; value: ReactNode; meta?: string; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(120px,32%)_1fr] gap-3 py-1.5 sm:grid-cols-[180px_1fr_auto]">
      <dt className="text-muted">{label}</dt>
      <dd className={`min-w-0 break-words ${strong ? "font-medium text-ink" : "text-ink-2"}`}>{value}</dd>
      {meta && <span className="hidden text-[11px] text-faint sm:block">{meta}</span>}
    </div>
  );
}

function WhyPanel({ result }: { result: TriageResult }) {
  const { why } = result;
  return (
    <div className="space-y-5 rounded-xl border border-line p-4 text-[13px]">
      <p className="leading-relaxed text-ink-2">{why.summary}</p>

      <Section title="What the agent read">
        <dl className="divide-y divide-line">
          {why.signals.map((c) => (
            <Row key={c.label + c.value} label={c.label} value={c.value} meta={SOURCE_LABEL[c.source]} strong={c.tone === "bad"} />
          ))}
        </dl>
      </Section>

      <Section title="Facts checked · from code and records">
        <dl className="divide-y divide-line">
          {why.facts.map((f) => (
            <Row key={f.label + f.value} label={f.label} value={f.value} meta={SOURCE_LABEL[f.source]} strong={f.tone === "bad"} />
          ))}
        </dl>
      </Section>

      <Section title="Rules, in order">
        <ol className="space-y-1.5">
          {why.checks.map((c) => (
            <li key={c.id} className="grid grid-cols-[26px_1fr] gap-2">
              <span className="font-mono text-xs text-faint">{c.id}</span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={c.status === "fired" ? "font-medium text-ink" : c.status === "passed" ? "text-ink-2" : "text-faint"}>
                    {c.title}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                    {c.status === "fired" && c.decision ? (
                      <>
                        <DecisionDot decision={c.decision} /> {DECISION_STYLE[c.decision].short}
                      </>
                    ) : c.status === "passed" ? (
                      "clear"
                    ) : (
                      <span className="text-faint">n/a</span>
                    )}
                  </span>
                </div>
                {c.status === "fired" && <p className="mt-0.5 text-xs leading-snug text-muted">{c.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Decision lock">
        <DecisionLock result={result} proposal={why.proposal} />
      </Section>

      {why.withheld.length > 0 && (
        <Section title="Withheld">
          <ul className="space-y-0.5 text-ink-2">
            {why.withheld.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Section>
      )}

      {why.handoff && (
        <Section title={`Handoff note · ${why.handoff.queue} · ${why.handoff.priority} · ${why.handoff.slaHours}h`}>
          <p className="leading-relaxed text-ink-2">{why.handoff.note}</p>
        </Section>
      )}

      <Section title="Phrasing · after the decision was locked">
        <Phrasing result={result} />
      </Section>

      <p className="text-[11px] text-faint">
        Decision: {result.engines.decision} · Phrasing: {result.engines.phrasing} · {result.timings.totalMs} ms
      </p>
    </div>
  );
}

function DecisionLock({ result, proposal }: { result: TriageResult; proposal: ProposalView | null }) {
  const g = result.why.guard;
  const step = (label: string, body: ReactNode) => (
    <div className="flex items-center gap-1.5">
      <span className="text-muted">{label}</span>
      {body}
    </div>
  );
  const d = (decision: typeof g.final) => (
    <span className="inline-flex items-center gap-1.5 font-medium text-ink">
      <DecisionDot decision={decision} />
      {DECISION_STYLE[decision].short}
    </span>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {step("Rules", d(g.rulesDecision))}
        <span className="text-faint">→</span>
        {step(
          proposal?.name ?? "Model",
          proposal?.ok && proposal.decision ? (
            <span className="inline-flex items-center gap-1.5">
              {d(proposal.decision.value)}
              <span className="text-faint">{pct(proposal.decision.probability)}</span>
            </span>
          ) : (
            <span className="text-faint">{proposal ? "unreachable" : "not configured"}</span>
          ),
        )}
        <span className="text-faint">→</span>
        {step("Locked", d(g.final))}
      </div>
      <p className={`leading-relaxed ${g.outcome === "overridden" ? "text-ink" : "text-muted"}`}>{g.note}</p>
      {proposal?.ok && proposal.flags && (
        <p className="font-mono text-[11px] text-faint">
          {Object.entries(proposal.flags)
            .map(([k, v]) => `P(${human(k)})=${pct(v)}`)
            .join(" · ")}
          {proposal.intent && ` · topic=${human(proposal.intent.value)}`}
        </p>
      )}
    </div>
  );
}

function Phrasing({ result }: { result: TriageResult }) {
  const p = result.why.phrasing;
  const lang = result.reply.language === "sq" ? "Albanian" : "English";
  if (p.engine === "model") {
    return (
      <p className="text-ink-2">
        Rewritten in {lang} by <span className="font-mono text-xs">{p.phraser}</span> from the approved draft. It passed every output
        check: no personal data, no new numbers or promises, same stance, right language.
      </p>
    );
  }
  if (!p.rejectedDraft && !p.issues.length) {
    return <p className="text-ink-2">No phrasing model configured, so the approved {lang} template was sent as written.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-ink-2">
        {p.rejectedDraft
          ? `The phrasing model's draft failed validation and was discarded; the approved ${lang} template was sent instead.`
          : "The phrasing model failed, so the approved template was sent."}
      </p>
      {p.rejectedDraft && (
        <blockquote className="rounded-lg bg-sunken px-3 py-2 text-muted line-through decoration-faint">{p.rejectedDraft}</blockquote>
      )}
      <ul className="space-y-0.5">
        {p.issues.map((i) => (
          <li key={i.check + i.detail} className="text-xs text-bad">
            ✕ <span className="font-mono">{i.check}</span> — {i.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}
