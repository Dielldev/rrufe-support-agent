"use client";

import { useEffect } from "react";
import { PageHeader } from "@/components/console/ui";
import type { AgentMap as Map, ToolKind } from "@/lib/agent/map";
import { CheckIcon, HumanIcon } from "../icons";

const KIND: Record<ToolKind, { label: string; cls: string }> = {
  read: { label: "Own data", cls: "bg-sunken text-ink-2" },
  public: { label: "Public", cls: "bg-sunken text-ink-2" },
  action: { label: "Action", cls: "bg-ink text-surface" },
  handoff: { label: "Handoff", cls: "border border-line text-ink-2" },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-[13px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function AgentMap({ map }: { map: Map }) {
  useEffect(() => {
    console.log("[agent-map] built from the running code (also GET /api/agent-map)", map);
  }, [map]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-16 sm:px-6">
      <PageHeader
        title="Agent map"
        description={
          <>
            Generated from the running code and live policy table, not written by hand. The same data is at{" "}
            <a href="/api/agent-map" className="font-mono text-ink underline underline-offset-2">
              /api/agent-map
            </a>{" "}
            and in the browser console.
          </>
        }
      />

      <Section title="How a message flows">
        <ol className="grid gap-2 sm:grid-cols-7">
          {map.steps.map((s) => (
            <li key={s.n} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center justify-between">
                <span className="grid size-6 place-items-center rounded-full bg-sunken text-xs font-semibold text-ink">{s.n}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${s.by === "ai" ? "bg-ink text-surface" : "bg-sunken text-ink-2"}`}>
                  {s.by === "ai" ? "AI" : "Code"}
                </span>
              </div>
              <p className="mt-2.5 text-[13px] leading-snug font-semibold text-ink">{s.name}</p>
              <p className="mt-1 text-xs leading-snug text-muted">{s.does}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Who decides">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className="grid size-6 place-items-center rounded-full bg-ink text-surface">
                <CheckIcon size={13} strokeWidth={2.6} />
              </span>
              The agent handles it alone
            </p>
            <ul className="mt-3 space-y-1.5 text-[13px] text-ink-2">
              {map.alone.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className="grid size-6 place-items-center rounded-full border border-line text-ink-2">
                <HumanIcon size={13} />
              </span>
              A person takes over
            </p>
            <ul className="mt-3 space-y-1.5 text-[13px] text-ink-2">
              {map.human.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section title={`Tools (${map.tools.length})`}>
        <div className="overflow-hidden rounded-xl border border-line">
          {map.tools.map((t, i) => (
            <div key={t.name} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 ${i ? "border-t border-line" : ""}`}>
              <span className="w-48 font-mono text-[12.5px] text-ink">{t.name}</span>
              <span className="min-w-0 flex-1 text-[13px] text-ink-2">{t.does}</span>
              <span className="text-xs text-muted">{t.guard}</span>
              <span className={`w-16 rounded-md px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase ${KIND[t.kind].cls}`}>{KIND[t.kind].label}</span>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-x-8 sm:grid-cols-2">
        <Section title="Data it uses">
          <div className="flex flex-wrap gap-1.5">
            {map.data.tables.map((t) => (
              <span key={t} className="rounded-md bg-sunken px-2 py-1 font-mono text-xs text-ink-2">
                {t}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Live policies: {map.data.policies.join(", ")}</p>
        </Section>
        <Section title="Models">
          <div className="space-y-1.5 text-[13px] text-ink-2">
            <p>
              <span className="text-muted">Agent </span>
              <span className="font-mono text-xs">{map.models.agent.join(" → ") || "none (rules only)"}</span>
            </p>
            <p>
              <span className="text-muted">Tone and risk </span>
              <span className="font-mono text-xs">{map.models.classifier}</span>
            </p>
            <p className="text-xs text-muted">Skills: {map.skills.map((s) => s.name).join(", ")}</p>
          </div>
        </Section>
      </div>
    </div>
  );
}
