"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import { SENDERS } from "@/lib/data/customers";
import type { TriageResult } from "@/lib/engine/types";
import { SCENARIOS, type Scenario } from "@/lib/scenarios";
import { DecisionPill, PageHeader } from "../console/ui";
import { ChannelIcon, CheckIcon, ChevronIcon, ResetIcon, XIcon } from "../icons";
import { triage, useChat } from "../shell/ChatProvider";

interface Run {
  standard?: TriageResult;
  stress?: TriageResult;
  error?: string;
}

export function TestRunner() {
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { prefill } = useChat();
  const router = useRouter();

  const runAll = useCallback(async () => {
    setRunning(true);
    setRuns({});
    // One at a time: a live model (Groq free tier) has a per-minute token budget.
    for (const s of SCENARIOS) {
      try {
        const [standard, stress] = await Promise.all([
          triage(s.text, s.senderId, "standard"),
          triage(s.text, s.senderId, "stress"),
        ]);
        setRuns((r) => ({ ...r, [s.id]: { standard, stress } }));
      } catch (err) {
        setRuns((r) => ({ ...r, [s.id]: { error: err instanceof Error ? err.message : "Failed" } }));
      }
    }
    setRunning(false);
  }, []);

  useEffect(() => {
    // Kick off the suite once when the page opens.
    runAll();
  }, [runAll]);

  const done = SCENARIOS.filter((s) => runs[s.id]?.standard);
  const passing = done.filter((s) => runs[s.id]!.standard!.decision === s.expected).length;
  const stressPassing = done.filter((s) => runs[s.id]!.stress!.decision === s.expected).length;

  function openInChat(s: Scenario) {
    prefill(s.text, s.senderId);
    router.push("/");
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-12 sm:px-6">
      <PageHeader
        title="Tests"
        description={
          <>
            The five challenge messages, each sent through the live pipeline twice: once normally, and once under the stress
            test (a decision model that always says “resolve” at 99%, plus a phrasing model that tries to promise, invent and
            leak). The outcome has to match both times.
          </>
        }
        action={
          <button
            type="button"
            onClick={runAll}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:bg-hover disabled:opacity-50"
          >
            <ResetIcon size={14} className={running ? "animate-spin [animation-direction:reverse]" : ""} />
            {running ? "Running…" : "Run again"}
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
        <Stat label="Normal" value={`${passing}/${SCENARIOS.length} passing`} ok={done.length === SCENARIOS.length && passing === SCENARIOS.length} />
        <Stat label="Stress test" value={`${stressPassing}/${SCENARIOS.length} passing`} ok={done.length === SCENARIOS.length && stressPassing === SCENARIOS.length} />
        <Stat label="Unit tests" value="npm test · 60 cases" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="border-b border-line bg-sunken text-xs text-muted">
            <tr>
              <th className="w-10 px-4 py-2.5 font-medium">#</th>
              <th className="px-4 py-2.5 font-medium">Message</th>
              <th className="px-4 py-2.5 font-medium">Expected</th>
              <th className="px-4 py-2.5 font-medium">Normal</th>
              <th className="px-4 py-2.5 font-medium">Stress test</th>
              <th className="px-4 py-2.5 font-medium">Rule</th>
              <th className="w-10 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {SCENARIOS.map((s, i) => {
              const run = runs[s.id];
              const sender = SENDERS.find((x) => x.id === s.senderId)!;
              const isOpen = open === s.id;
              return (
                <Fragment key={s.id}>
                  <tr className="align-top">
                    <td className="px-4 py-3.5 font-mono text-xs text-faint">0{i + 1}</td>
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-ink">{s.title}</div>
                      <div className="mt-0.5 text-ink-2">“{s.text}”</div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                        <ChannelIcon channel={sender.channel} size={12} /> {sender.displayName} · {s.challenge}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <DecisionPill decision={s.expected} size="sm" />
                    </td>
                    <td className="px-4 py-3.5">
                      <Result result={run?.standard} expected={s.expected} error={run?.error} />
                    </td>
                    <td className="px-4 py-3.5">
                      <Result result={run?.stress} expected={s.expected} error={run?.error} />
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-ink-2">{run?.standard?.why.firedRule.id ?? "—"}</td>
                    <td className="px-4 py-3.5">
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : s.id)}
                        disabled={!run?.standard}
                        aria-expanded={isOpen}
                        aria-label="Show reply"
                        className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink disabled:opacity-30"
                      >
                        <ChevronIcon size={14} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>
                    </td>
                  </tr>
                  {isOpen && run?.standard && run.stress && (
                    <tr>
                      <td />
                      <td colSpan={6} className="px-4 pb-4">
                        <div className="animate-rise space-y-3 rounded-xl bg-sunken p-4 text-[13px]">
                          <div>
                            <div className="mb-1 text-xs text-muted">Reply sent</div>
                            <p className="leading-relaxed text-ink">{run.standard.reply.text}</p>
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-muted">Why</div>
                            <p className="leading-relaxed text-ink-2">{run.standard.why.summary}</p>
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-muted">Stress test</div>
                            <p className="leading-relaxed text-ink-2">{run.stress.why.guard.note}</p>
                            <p className="mt-1 text-muted line-through decoration-faint">{run.stress.why.phrasing.rejectedDraft}</p>
                            <p className="mt-1 text-xs text-muted">
                              Rejected for: {run.stress.why.phrasing.issues.map((x) => x.check).join(", ")}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => openInChat(s)}
                            className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-hover"
                          >
                            Open in chat
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted">{label}</span>
      <span className="inline-flex items-center gap-1 font-medium text-ink">
        {ok && <CheckIcon size={13} strokeWidth={2.6} className="text-dot-ok" />}
        {value}
      </span>
    </div>
  );
}

function Result({ result, expected, error }: { result?: TriageResult; expected: TriageResult["decision"]; error?: string }) {
  if (error) return <span className="text-xs text-bad">{error}</span>;
  if (!result) return <span className="inline-block h-5 w-20 animate-pulse rounded-full bg-sunken" />;
  const ok = result.decision === expected;
  return (
    <span className="inline-flex items-center gap-2">
      <DecisionPill decision={result.decision} size="sm" />
      {ok ? <CheckIcon size={14} strokeWidth={2.6} className="text-dot-ok" /> : <XIcon size={14} strokeWidth={2.6} className="text-bad" />}
    </span>
  );
}
