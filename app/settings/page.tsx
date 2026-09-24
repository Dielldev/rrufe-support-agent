import type { Metadata } from "next";
import { PageHeader } from "@/components/console/ui";
import { engineStatus } from "@/lib/engine/config";
import { DECISION_CONFIDENCE_FLOOR, FLAG_THRESHOLD, INTENT_ADOPT_THRESHOLD, LLM_FLAG_THRESHOLD } from "@/lib/engine/guard";

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

export default function SettingsPage() {
  const status = engineStatus();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-12 sm:px-6">
      <PageHeader
        title="Settings"
        description="The engine is picked automatically from the keys you have: Jev when an AI Gateway key is set, otherwise Groq, otherwise the rules alone. Either way, the rules and the guard make the final call."
      />

      <h2 className="mb-3 text-sm font-semibold">Engines</h2>
      <div className="divide-y divide-line rounded-xl border border-line">
        <Row label="AI Gateway (Jev)" value={status.gateway ? "Connected" : "Not configured"} live={status.gateway} />
        <Row label="Groq" value={status.groq ? "Connected" : "Not configured"} live={status.groq} />
        <Row
          label="Decision"
          value={status.decision.label}
          live={status.decision.live}
          hint="The model proposes a typed decision; deterministic rules set the floor and the guard locks it."
        />
        <Row
          label="Phrasing"
          value={status.phrasing.label}
          live={status.phrasing.live}
          hint="Runs only after the decision is locked. Any draft that fails validation is replaced by the approved template."
        />
      </div>

      {!status.gateway && (
        <div className="mt-4 rounded-xl bg-sunken px-4 py-3.5 text-[13px] text-ink-2">
          Add keys to <span className="font-mono text-xs">.env.local</span> and restart the server:
          <pre className="mt-2 overflow-x-auto rounded-lg bg-surface px-3 py-2 font-mono text-xs leading-5 text-ink ring-1 ring-line">
            {"GROQ_API_KEY=gsk_...          # used now\nAI_GATEWAY_API_KEY=...         # when set, Jev takes over"}
          </pre>
        </div>
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
