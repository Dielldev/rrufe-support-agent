import type { Metadata } from "next";
import { PageHeader } from "@/components/console/ui";
import { POLICY_CATALOG, UNCOVERED_TOPICS } from "@/lib/data/shop";

export const metadata: Metadata = { title: "Policies · Rrufe Support" };

export default function PoliciesPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-12 sm:px-6">
      <PageHeader
        title="Policies"
        description="The written policy book. If an answer isn't here, the agent doesn't give one. It hands the question to a person instead."
      />

      <div className="divide-y divide-line rounded-xl border border-line">
        {POLICY_CATALOG.map((p) => (
          <div key={p.id} className="grid gap-1 px-4 py-3.5 sm:grid-cols-[160px_1fr]">
            <div className="text-[13px] font-medium text-ink">{p.title}</div>
            <div className="text-[13px] text-ink-2">{p.summary}</div>
          </div>
        ))}
      </div>

      <h2 className="mt-10 mb-1 text-sm font-semibold">No written policy</h2>
      <p className="mb-3 text-sm text-muted">Customers ask about these, but the shop has never decided. Any mention escalates to a human.</p>
      <div className="divide-y divide-line rounded-xl border border-line">
        {UNCOVERED_TOPICS.map((t) => (
          <div key={t.id} className="grid gap-1 px-4 py-3.5 sm:grid-cols-[160px_1fr]">
            <div className="text-[13px] font-medium text-ink">{t.label}</div>
            <div className="text-[13px] text-muted">
              Triggered by phrases like {t.examples.map((e) => `“${e}”`).join(", ")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
