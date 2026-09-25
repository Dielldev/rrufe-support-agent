import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { PageHeader } from "@/components/console/ui";
import { databaseConfig } from "@/lib/db/client";
import { tableCounts } from "@/lib/db/repo";
import { engineStatus } from "@/lib/engine/config";
import { DECISION_CONFIDENCE_FLOOR, FLAG_THRESHOLD, INTENT_ADOPT_THRESHOLD, LLM_FLAG_THRESHOLD } from "@/lib/engine/guard";
import { OPS } from "@/lib/shop/operations";
import { resetAllowed, resetDemoData, setFallbackMode } from "./actions";

const DB_KIND = {
  remote: "Hosted (Turso / libSQL)",
  file: "Local SQLite file",
  memory: "In-memory",
  ephemeral: "Temporary file (resets on cold start)",
} as const;

function dbLocation(): string {
  const { url, kind } = databaseConfig();
  if (kind !== "remote") return url.replace(/^file:/, "");
  try {
    return new URL(url).host;
  } catch {
    return "configured";
  }
}

export const metadata: Metadata = { title: "Settings · Rrufe Support" };

function Row({ label, value, live, hint }: { label: string; value: string; live?: boolean; hint?: string }) {
  return (
    <div className="grid gap-1 px-4 py-3.5 sm:grid-cols-[200px_1fr]">
      <div className="text-[13px] text-muted">{label}</div>
      <div>
        <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
          {live !== undefined && <span className={`size-1.5 rounded-full ${live ? "bg-dot-ok" : "bg-faint"}`} />}
          {value}
        </div>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
    </div>
  );
}

export default async function SettingsPage() {
  await connection();
  const jar = await cookies();
  const fallbackCookie = jar.get("rrufe_allow_fallback")?.value;
  const status = engineStatus(fallbackCookie);
  const { kind } = databaseConfig();
  const [counts, canReset] = await Promise.all([tableCounts().catch(() => null), resetAllowed()]);
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-12 sm:px-6">
      <PageHeader
        title="Settings"
        description="The engine is picked automatically from the keys you have: OpenRouter or Groq for the agent and phrasing, Jev when an AI Gateway key is set, otherwise the rules alone. The rules and the guard decide what needs a person; the agent answers the rest, with access decided in code."
      />

      <h2 className="mb-3 text-sm font-semibold">Engines</h2>
      <div className="divide-y divide-line rounded-xl border border-line">
        <Row label="OpenRouter" value={status.openrouter ? "Connected" : "Not configured"} live={status.openrouter} />
        <Row label="AI Gateway (Jev)" value={status.gateway ? "Connected" : "Not configured"} live={status.gateway} />
        <Row label="Groq" value={status.groq ? "Connected" : "Not configured"} live={status.groq} />
        <Row
          label="Decision"
          value={status.decision.label}
          live={status.decision.live}
          hint="The model proposes a typed decision; deterministic rules set the floor and the guard locks it."
        />
        <Row
          label="Agent"
          value={status.agent.label}
          live={status.agent.live}
          hint="Writes the reply with tools scoped to the sender's own records, the catalog and the policy. Runs only when the intake checks don't hand the message to a person. AGENT_DISABLED=1 turns it off."
        />
        <Row
          label="Phrasing"
          value={status.phrasing.label}
          live={status.phrasing.live}
          hint="Rewrites the fixed rule path's approved draft after the decision is locked: handoff replies, and every reply when the agent is off. When fallback is disabled, a live AI model is strictly required."
        />
        <Row
          label="Template fallback (Regex)"
          value={status.fallbackAllowed ? "Enabled (Regex fallback)" : "Disabled (Pure AI required)"}
          live={!status.fallbackAllowed}
          hint={
            status.fallbackAllowed
              ? "When no AI key is configured or model calls fail, template replies are sent as a fallback."
              : "Disabled. When no AI key is configured or phrasing fails, template drafts are blocked so you can test real AI model responses purely."
          }
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-4 rounded-xl bg-sunken px-4 py-3 text-[13px] text-ink-2">
        <div>
          <span className="font-medium text-ink">
            {status.fallbackAllowed ? "Template Fallback is active" : "Pure AI Mode is active (Fallback disabled)"}
          </span>
          <p className="mt-0.5 text-xs text-muted">
            {status.fallbackAllowed
              ? "Messages will fall back to hardcoded regex templates if AI keys are missing."
              : "Template replies are blocked. The agent strictly requires a live AI phrasing model."}
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await setFallbackMode(!status.fallbackAllowed);
          }}
        >
          <button
            type="submit"
            className="shrink-0 rounded-lg border border-line-strong bg-surface px-3 py-1.5 font-medium text-ink shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:bg-hover cursor-pointer"
          >
            {status.fallbackAllowed ? "Disable Fallback (Pure AI)" : "Enable Fallback"}
          </button>
        </form>
      </div>

      {(!status.openrouter || !status.groq) && (
        <div className="mt-4 rounded-xl bg-sunken px-4 py-3.5 text-[13px] text-ink-2">
          Add keys to <span className="font-mono text-xs">.env.local</span> and restart the server:
          <pre className="mt-2 overflow-x-auto rounded-lg bg-surface px-3 py-2 font-mono text-xs leading-5 text-ink ring-1 ring-line">
            {"OPENROUTER_API_KEY=sk-or-v1-...  # agent + phrasing\nGROQ_API_KEY=gsk_...          # classifier fallback\nAI_GATEWAY_API_KEY=...         # when set, Jev takes over"}
          </pre>
        </div>
      )}

      <h2 className="mt-10 mb-3 text-sm font-semibold">Database</h2>
      <div className="divide-y divide-line rounded-xl border border-line">
        <Row
          label="Connection"
          value={counts ? DB_KIND[kind] : "Unavailable"}
          live={Boolean(counts)}
          hint={`${dbLocation()} · set DATABASE_URL (and DATABASE_AUTH_TOKEN) to use a hosted database`}
        />
        {counts && (
          <Row
            label="Rows"
            value={`${counts.customers} customers · ${counts.orders} orders · ${counts.policies} policies`}
            hint={`${counts.conversations} conversations · ${counts.agent_log} agent decisions logged · ${counts.escalations} escalations`}
          />
        )}
        <Row label="Today" value={process.env.SHOP_TODAY ? `${process.env.SHOP_TODAY} (pinned by SHOP_TODAY)` : "Real date"} hint="The seed data is written for 2026-09-24. Pin SHOP_TODAY to replay the scenarios on any day." />
        <Row
          label="Service levels"
          value={`Urgent ${OPS.urgentSlaHours}h · standard ${OPS.standardSlaHours}h`}
          hint={`Late parcels go to a person after ${OPS.lateHandoffDays} days past the expected date. ${OPS.repeatThreshold}+ unanswered messages in ${OPS.repeatWindowDays} days = repeat contact.`}
        />
      </div>
      {canReset && (
        <form action={resetDemoData} className="mt-3 flex items-center justify-between gap-4 rounded-xl bg-sunken px-4 py-3 text-[13px] text-ink-2">
          <span>Chat messages are written to the conversations and agent_log tables. Reset to go back to the seed data.</span>
          <button
            type="submit"
            className="shrink-0 rounded-lg border border-line-strong bg-surface px-3 py-1.5 font-medium text-ink shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:bg-hover"
          >
            Reset demo data
          </button>
        </form>
      )}

      <h2 className="mt-10 mb-3 text-sm font-semibold">Guard thresholds</h2>
      <div className="divide-y divide-line rounded-xl border border-line">
        <Row label="Risk flag" value={`P ≥ ${FLAG_THRESHOLD} (Jev) · ≥ ${LLM_FLAG_THRESHOLD} (Groq)`} hint="The model can raise anger, repeat-contact, third-party or data-request flags. It can never clear one." />
        <Row label="Decision confidence" value={`< ${DECISION_CONFIDENCE_FLOOR} → human`} hint="If the model is unsure, a person reads the message." />
        <Row label="Topic adoption" value={`P ≥ ${INTENT_ADOPT_THRESHOLD}`} hint="The model may name the topic only when the keyword reader finds none. If they disagree, the message escalates." />
      </div>
    </div>
  );
}
