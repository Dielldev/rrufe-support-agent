"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ProductThumbs } from "@/components/orders/ProductThumbs";
import type {
  AgentView,
  OrderCardData,
  OrderStatus,
  ProposalView,
  RunMode,
  Sender,
  ToolAccess,
  TriageResult,
  VoucherCardData,
} from "@/lib/engine/types";
import type { ProgressStep } from "../shell/ChatProvider";
import { DECISION_STYLE, DecisionDot } from "../console/ui";
import { BotIcon, ChannelIcon, CheckIcon, ChevronIcon, ChevronRightIcon, CopyIcon, GiftIcon, LockIcon, XIcon } from "../icons";

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
  catalog: "catalog",
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

function StepIcon({ status }: { status: ProgressStep["status"] }) {
  if (status === "active") {
    return <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-line-strong border-t-ink-2" aria-hidden="true" />;
  }
  if (status === "done") return <CheckIcon size={12} strokeWidth={2.4} className="shrink-0 text-dot-ok" />;
  if (status === "blocked") return <LockIcon size={12} strokeWidth={2.2} className="shrink-0 text-faint" />;
  return <XIcon size={12} strokeWidth={2.4} className="shrink-0 text-bad" />;
}

const STEP_STATUS_LABEL: Record<ProgressStep["status"], string> = {
  active: "in progress",
  done: "done",
  blocked: "not available for this account",
  failed: "failed",
};

function StepList({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol className="space-y-1">
      {steps.map((s) => (
        <li key={s.id} className="flex items-center gap-2 text-[13px]">
          <StepIcon status={s.status} />
          <span
            className={
              s.status === "active"
                ? "animate-shimmer bg-[linear-gradient(90deg,var(--color-muted)_0%,var(--color-ink)_50%,var(--color-muted)_100%)] bg-[length:200%_100%] bg-clip-text text-transparent"
                : s.status === "blocked"
                  ? "text-faint"
                  : "text-muted"
            }
          >
            {s.label}
          </span>
          <span className="sr-only">({STEP_STATUS_LABEL[s.status]})</span>
        </li>
      ))}
    </ol>
  );
}

/** Live view while the reply is being prepared: the steps, then the checked text as it streams. */
export function ThinkingMessage({ steps, partial, startedAt }: { steps: ProgressStep[]; partial?: string; startedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const seconds = startedAt ? Math.max(0, (now - startedAt) / 1000) : 0;
  return (
    <div className="flex animate-rise gap-3" aria-live="polite">
      <AgentAvatar />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 pt-0.5 text-[13px]">
          <span className="font-semibold text-ink">Rrufe Support</span>
          <span className="text-faint">· working on it · {seconds.toFixed(1)}s</span>
        </div>
        {steps.length > 0 ? (
          <div className="mt-2 border-l-2 border-line pl-3">
            <StepList steps={steps} />
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1.5 animate-blink rounded-full bg-faint" style={{ animationDelay: `${i * 160}ms` }} />
            ))}
          </div>
        )}
        {partial && (
          <p className="mt-2 text-[14.5px] leading-7 whitespace-pre-line text-ink">
            {partial}
            <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-blink bg-ink-2" aria-hidden="true" />
          </p>
        )}
      </div>
    </div>
  );
}

/** Reward card for a delay voucher: the code stays hidden until the customer reveals it. */
export function VoucherCard({ voucher }: { voucher: VoucherCardData }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(voucher.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked; the code is on screen either way.
    }
  };
  const reward =
    voucher.kind === "gift_card"
      ? { big: `€${voucher.amountEur}`, small: "gift card" }
      : voucher.kind === "free_shipping"
        ? { big: "Free", small: "shipping" }
        : { big: `${voucher.percent}%`, small: "off" };
  const until = new Date(`${voucher.expiresOn}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#fb7a2b] to-[#e8530e] p-5 text-white shadow-sm">
      <span aria-hidden="true" className="pointer-events-none absolute -right-3 -bottom-8 text-[112px] leading-none font-black tracking-tighter text-white/10 select-none">
        {reward.big}
      </span>
      <div className="relative flex items-center gap-2 text-[13px] font-semibold text-white/85">
        <GiftIcon size={15} />
        {voucher.alreadyIssued ? "Your voucher" : "For the wait"}
      </div>
      <p className="relative mt-1.5 text-4xl leading-none font-extrabold tracking-tight">
        {reward.big} <span className="text-2xl font-bold">{reward.small}</span>
      </p>
      <p className="relative mt-2 text-sm text-white/85">Next order · until {until}</p>
      <div className="relative mt-4">
        {revealed ? (
          <div className="flex animate-reveal items-center justify-between gap-3 rounded-xl bg-white/15 px-3.5 py-2.5">
            <span className="font-mono text-base font-bold tracking-wider select-all">{voucher.code}</span>
            <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold transition hover:bg-white/15">
              {copied ? <CheckIcon size={14} strokeWidth={2.4} /> : <CopyIcon size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="w-full rounded-xl bg-white px-3 py-2.5 text-[15px] font-bold text-[#e8530e] shadow-sm transition hover:bg-orange-50 active:scale-[0.99]"
          >
            Reveal code
          </button>
        )}
      </div>
    </div>
  );
}

function WorkedSteps({ steps, elapsedMs }: { steps: ProgressStep[]; elapsedMs?: number }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 text-xs text-faint hover:text-muted">
        Worked through {steps.length} step{steps.length === 1 ? "" : "s"}
        {elapsedMs !== undefined ? ` · ${(elapsedMs / 1000).toFixed(1)}s` : ""}
        <ChevronIcon size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-1.5 border-l-2 border-line pl-3">
          <StepList steps={steps} />
        </div>
      )}
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

const ORDER_STATUS: Record<OrderStatus, { label: string; dot: string; badge: string }> = {
  pending: { label: "Pending", dot: "bg-faint", badge: "bg-sunken text-muted" },
  processing: { label: "Preparing", dot: "bg-faint", badge: "bg-sunken text-muted" },
  shipped: { label: "Shipped", dot: "bg-dot-esc", badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  delivered: { label: "Delivered", dot: "bg-dot-ok", badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  cancelled: { label: "Cancelled", dot: "bg-bad", badge: "bg-red-500/10 text-red-700 dark:text-red-400" },
  returned: { label: "Returned", dot: "bg-bad", badge: "bg-red-500/10 text-red-700 dark:text-red-400" },
};

export function OrderCard({ order }: { order: OrderCardData }) {
  const st = ORDER_STATUS[order.status] ?? { label: order.status, dot: "bg-faint", badge: "bg-sunken text-muted" };
  return (
    <div className="group rounded-xl border border-line bg-surface p-3.5 shadow-xs transition hover:border-line-strong hover:shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-line/60 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-semibold text-ink">#{order.id}</span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${st.badge}`}>
            <span className={`size-1.5 rounded-full ${st.dot}`} />
            {st.label}
          </span>
        </div>
        <Link
          href={`/orders?q=${order.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted transition hover:text-ink"
        >
          View in Orders
          <ChevronRightIcon size={12} />
        </Link>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <ProductThumbs images={order.images ?? []} />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-ink">{order.items}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
            <span>Placed {order.placedDaysAgo}d ago</span>
            {order.deliveredDaysAgo !== undefined ? (
              <>
                <span>·</span>
                <span className="text-ink-2 font-medium">Delivered {order.deliveredDaysAgo}d ago</span>
              </>
            ) : order.expectedBy ? (
              <>
                <span>·</span>
                <span className="text-ink-2 font-medium">Due {order.expectedBy}</span>
              </>
            ) : null}
            {order.carrier && (
              <>
                <span>·</span>
                <span>{order.carrier}{order.tracking ? ` · ${order.tracking.replaceAll("_", " ")}` : ""}</span>
              </>
            )}
          </div>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
          €{order.total.toFixed(2)}
        </span>
      </div>
      <OrderTimeline order={order} />
    </div>
  );
}

const shortDay = (iso?: string) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : undefined;

function OrderTimeline({ order }: { order: OrderCardData }) {
  if (order.status === "cancelled" || order.status === "returned") return null;
  const shipped = order.status === "shipped" || order.status === "delivered";
  const delivered = order.status === "delivered";
  const steps = [
    { label: "Ordered", date: shortDay(order.placedOn), done: true },
    { label: "Shipped", date: shortDay(order.shippedOn), done: shipped },
    { label: "On the way", date: undefined, done: shipped },
    { label: "Delivered", date: delivered ? shortDay(order.deliveredOn) : order.expectedBy ? `due ${shortDay(order.expectedBy)}` : undefined, done: delivered },
  ];
  const current = steps.filter((st) => st.done).length - 1;
  return (
    <ol className="mt-3.5 grid grid-cols-4 border-t border-line/60 pt-3.5">
      {steps.map((st, i) => (
        <li key={st.label} className="relative flex flex-col items-center text-center">
          {i > 0 && <span aria-hidden="true" className={`absolute top-2.5 right-1/2 left-[-50%] h-0.5 ${st.done ? "bg-ink" : "bg-line"}`} />}
          <span
            className={`relative grid size-5 place-items-center rounded-full ${st.done ? "bg-ink text-surface" : "border-2 border-line bg-surface"} ${i === current && !delivered ? "ring-4 ring-ink/10" : ""}`}
          >
            {st.done && <CheckIcon size={11} strokeWidth={3} />}
          </span>
          <span className={`mt-1.5 text-xs font-medium ${st.done ? "text-ink" : "text-muted"}`}>{st.label}</span>
          {st.date && <span className="text-[11px] text-faint">{st.date}</span>}
        </li>
      ))}
    </ol>
  );
}

export function AgentMessage({
  result,
  mode,
  steps = [],
  elapsedMs,
}: {
  result: TriageResult;
  mode: RunMode;
  steps?: ProgressStep[];
  elapsedMs?: number;
}) {
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
          {mode === "stress" && <span className="text-faint">· stress test</span>}
        </div>

        <WorkedSteps steps={steps} elapsedMs={elapsedMs} />

        <p className="mt-1.5 text-[14.5px] leading-7 whitespace-pre-line text-ink">{result.reply.text}</p>

        {result.vouchers && result.vouchers.length > 0 && (
          <div className="mt-3 space-y-2.5">
            {result.vouchers.map((v) => (
              <VoucherCard key={v.code} voucher={v} />
            ))}
          </div>
        )}

        {result.orders && result.orders.length > 0 && (
          <div className="mt-3 space-y-2.5">
            {result.orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}

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
            {result.agent && result.why.phrasing.engine === "agent"
              ? `Agent · intake ${result.why.firedRule.id}`
              : `${result.why.firedRule.id} · ${result.why.firedRule.title}`}
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

      {result.agent && (
        <Section title={`Agent · ${result.agent.model} · ${result.agent.steps} step${result.agent.steps === 1 ? "" : "s"}`}>
          <AgentTrace agent={result.agent} />
        </Section>
      )}

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

      <Section title={why.phrasing.engine === "agent" ? "Reply · output checks" : "Phrasing · after the decision was locked"}>
        <Phrasing result={result} />
      </Section>

      <p className="text-[11px] text-faint">
        Decision: {result.engines.decision}
        {result.engines.agent ? ` · Agent: ${result.engines.agent}` : ""} · Reply: {result.engines.phrasing} · {result.timings.totalMs} ms
        {result.timings.classifierMs !== undefined ? ` (classifier ${result.timings.classifierMs} ms` : ""}
        {result.timings.classifierMs !== undefined && result.timings.agentMs !== undefined ? `, agent ${result.timings.agentMs} ms in parallel)` : result.timings.classifierMs !== undefined ? ")" : ""}
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

const ACCESS_STYLE: Record<ToolAccess, { label: string; cls: string }> = {
  granted: { label: "own data", cls: "text-ink-2" },
  public: { label: "public", cls: "text-muted" },
  action: { label: "action", cls: "text-ink-2" },
  denied: { label: "refused", cls: "text-bad font-medium" },
  refused: { label: "not allowed", cls: "text-muted" },
  error: { label: "error", cls: "text-bad" },
};

function AgentTrace({ agent }: { agent: AgentView }) {
  const scope = { account: "Own account", per_order: "Single order, if verified", public: "Catalog + policy only" }[agent.scope.level];
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-sunken px-3 py-2">
        <p className="text-xs font-medium text-ink">Data access · {scope}</p>
        <p className="mt-0.5 text-xs leading-snug text-muted">{agent.scope.note}</p>
      </div>
      {agent.toolCalls.length ? (
        <ol className="space-y-1.5">
          {agent.toolCalls.map((t, i) => {
            const a = ACCESS_STYLE[t.access];
            const args = Object.entries(t.input).filter(([, v]) => v !== undefined);
            return (
              <li key={`${t.tool}-${i}`} className="grid grid-cols-[18px_1fr_auto] items-baseline gap-2">
                <span className="font-mono text-[11px] text-faint">{i + 1}</span>
                <div className="min-w-0">
                  <span className="font-mono text-xs text-ink">
                    {t.tool}({args.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")})
                  </span>
                  <p className="text-xs leading-snug text-muted">{t.summary}</p>
                </div>
                <span className={`text-[11px] ${a.cls}`}>{a.label}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-ink-2">No lookups — the reply didn&apos;t need any records.</p>
      )}
    </div>
  );
}

function Phrasing({ result }: { result: TriageResult }) {
  const p = result.why.phrasing;
  const lang = result.reply.language === "sq" ? "Albanian" : "English";
  if (p.engine === "agent") {
    return (
      <div className="space-y-2">
        <p className="text-ink-2">
          Written in {lang} by the agent from its tool results. {p.issues.length ? "Its first reply was blocked by the output checks and rewritten; the rewrite" : "It"} passed every
          check: no one else&apos;s personal data, no numbers or promises that aren&apos;t in the records or policy, right language.
        </p>
        {p.rejectedDraft && (
          <blockquote className="rounded-lg bg-sunken px-3 py-2 text-muted line-through decoration-faint">{p.rejectedDraft}</blockquote>
        )}
        {p.issues.map((i, n) => (
          <p key={`${n}-${i.check}`} className="text-xs text-bad">
            ✕ <span className="font-mono">{i.check}</span> — {i.detail}
          </p>
        ))}
      </div>
    );
  }
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
          ? `The ${result.agent ? "agent's" : "phrasing model's"} draft failed validation and was discarded; the approved ${lang} template was sent instead.`
          : "The phrasing model failed, so the approved template was sent."}
      </p>
      {p.rejectedDraft && (
        <blockquote className="rounded-lg bg-sunken px-3 py-2 text-muted line-through decoration-faint">{p.rejectedDraft}</blockquote>
      )}
      <ul className="space-y-0.5">
        {p.issues.map((i, n) => (
          <li key={`${n}-${i.check}`} className="text-xs text-bad">
            ✕ <span className="font-mono">{i.check}</span> — {i.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}
