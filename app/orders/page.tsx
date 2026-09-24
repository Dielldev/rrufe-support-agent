import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/console/ui";
import { ChannelIcon } from "@/components/icons";
import { shopRecords } from "@/lib/display";

export const metadata: Metadata = { title: "Orders · Rrufe Support" };

const STATUS: Record<string, { label: string; dot: string }> = {
  processing: { label: "Preparing", dot: "bg-faint" },
  in_transit: { label: "In transit", dot: "bg-dot-esc" },
  delivered: { label: "Delivered", dot: "bg-dot-ok" },
  cancelled: { label: "Cancelled", dot: "bg-bad" },
};

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const { q } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q)?.trim().toLowerCase() ?? "";
  const records = shopRecords(new Date());
  const orders = records.orders.filter((o) =>
    !query
      ? true
      : [o.id, o.item, o.buyer.name, o.buyer.email, o.buyer.phone, o.buyer.address, o.status].join(" ").toLowerCase().includes(query),
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-12 sm:px-6">
      <PageHeader
        title="Orders"
        description="The in-memory records the agent checks facts against. Each order belongs to one customer, and the inbox account shown under the buyer is the only one that gets its details without extra verification."
      />

      {query && (
        <p className="mb-4 text-sm text-muted">
          {orders.length} result{orders.length === 1 ? "" : "s"} for “{query}” ·{" "}
          <Link href="/orders" className="font-medium text-ink hover:underline">
            Clear
          </Link>
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[820px] text-left text-[13px]">
          <thead className="border-b border-line bg-sunken text-xs text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Order</th>
              <th className="px-4 py-2.5 font-medium">Item</th>
              <th className="px-4 py-2.5 font-medium">Buyer</th>
              <th className="px-4 py-2.5 font-medium">Contact on file</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Placed</th>
              <th className="px-4 py-2.5 text-right font-medium">Delivered</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {orders.map((o) => (
              <tr key={o.id} className="align-top hover:bg-sunken/60">
                <td className="px-4 py-3 font-mono font-medium text-ink">#{o.id}</td>
                <td className="px-4 py-3 text-ink">{o.item}</td>
                <td className="px-4 py-3">
                  <div className="text-ink">{o.buyer.name}</div>
                  <div className="text-xs text-muted">{o.buyer.address}</div>
                  {o.linked.map((l) => (
                    <div key={l.handle} className="mt-1 inline-flex items-center gap-1 text-xs text-ink-2">
                      <ChannelIcon channel={l.channel} size={11} className="text-muted" /> {l.handle}
                    </div>
                  ))}
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  <div>{o.buyer.phone}</div>
                  <div>{o.buyer.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-ink-2">
                    <span className={`size-1.5 rounded-full ${STATUS[o.status].dot}`} />
                    {STATUS[o.status].label}
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap text-ink-2 tabular-nums">{o.placedDaysAgo}d ago</td>
                <td className="px-4 py-3 text-right whitespace-nowrap text-ink-2 tabular-nums">
                  {o.deliveredDaysAgo === undefined ? <span className="text-faint">—</span> : `${o.deliveredDaysAgo}d ago`}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  No orders match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 mb-3 text-sm font-semibold">Contact log</h2>
      <p className="mb-3 text-sm text-muted">Two or more unanswered contacts in 14 days count as repeat contact, which always escalates.</p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="border-b border-line bg-sunken text-xs text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="px-4 py-2.5 font-medium">Channel</th>
              <th className="px-4 py-2.5 font-medium">Message</th>
              <th className="px-4 py-2.5 font-medium">Answered</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {records.contactLog.flatMap((c) =>
              c.entries.map((e) => (
                <tr key={c.sender + e.daysAgo}>
                  <td className="px-4 py-3 text-ink">{c.sender}</td>
                  <td className="px-4 py-3 text-ink-2">{e.daysAgo}d ago</td>
                  <td className="px-4 py-3 text-ink-2 capitalize">{e.channel}</td>
                  <td className="px-4 py-3 text-ink-2">{e.summary}</td>
                  <td className="px-4 py-3 text-ink-2">{e.answered ? "Yes" : "No"}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
