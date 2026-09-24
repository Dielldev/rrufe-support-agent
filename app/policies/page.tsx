import type { Metadata } from "next";
import { connection } from "next/server";
import { PageHeader } from "@/components/console/ui";
import { getPolicyBook } from "@/lib/db/repo";
import { TOPIC_DETECTORS, topicInfo, uncoveredTopics } from "@/lib/engine/topics";

export const metadata: Metadata = { title: "Policies · Rrufe Support" };

export default async function PoliciesPage() {
  await connection();
  const book = await getPolicyBook();
  const gaps = uncoveredTopics(book);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-12 sm:px-6">
      <PageHeader
        title="Policies"
        description="The policies table in the shop database. The agent only states what is written here. A topic with no row goes to a person, and adding a row makes the agent answer it."
      />

      <div className="divide-y divide-line rounded-xl border border-line">
        {book.rows.map((p) => (
          <div key={p.topic} className="grid gap-1 px-4 py-3.5 sm:grid-cols-[160px_1fr]">
            <div className="text-[13px] font-medium text-ink">{topicInfo(p.topic)?.label ?? p.topic[0].toUpperCase() + p.topic.slice(1)}</div>
            <div>
              <div className="text-[13px] text-ink-2">{p.text}</div>
              {p.value && <div className="mt-0.5 font-mono text-[11px] text-faint">value: {p.value}</div>}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-10 mb-1 text-sm font-semibold">No written policy</h2>
      <p className="mb-3 text-sm text-muted">Customers ask about these, but the policies table has no row for them. Any mention escalates to a human.</p>
      <div className="divide-y divide-line rounded-xl border border-line">
        {gaps.map((t) => {
          const detector = TOPIC_DETECTORS.find((d) => d.id === t.id);
          return (
            <div key={t.id} className="grid gap-1 px-4 py-3.5 sm:grid-cols-[160px_1fr]">
              <div className="text-[13px] font-medium text-ink">{t.label}</div>
              <div className="text-[13px] text-muted">
                {detector ? <>Triggered by phrases like {detector.examples.map((e) => `“${e}”`).join(", ")}</> : <>Topic key “{t.id}”</>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
