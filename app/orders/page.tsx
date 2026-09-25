import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { PageHeader } from "@/components/console/ui";
import { ChannelIcon } from "@/components/icons";
import { OrderCustomerBanner } from "@/components/orders/OrderCustomerBanner";
import { ProductThumbs } from "@/components/orders/ProductThumbs";
import { shopRecords } from "@/lib/display";
import { shopNow } from "@/lib/shop/operations";

export const metadata: Metadata = { title: "Orders · Rrufe Support" };

const STATUS: Record<string, { label: string; dot: string }> = {
  pending: { label: "Pending", dot: "bg-faint" },
  processing: { label: "Preparing", dot: "bg-faint" },
  shipped: { label: "Shipped", dot: "bg-dot-esc" },
  delivered: { label: "Delivered", dot: "bg-dot-ok" },
  cancelled: { label: "Cancelled", dot: "bg-bad" },
  returned: { label: "Returned", dot: "bg-bad" },
};

const ACTION: Record<string, string> = { auto_reply: "Auto-reply", escalate: "Escalated" };

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q)?.trim().toLowerCase() ?? "";
  await connection();
  const jar = await cookies();
  const customerId = jar.get("rrufe_customer_id")?.value;
  const records = await shopRecords(shopNow(), customerId);
  const orders = records.orders.filter((o) =>
    !query
      ? true
      : [o.id, o.items, o.buyer.name, o.buyer.email, o.buyer.phone, o.buyer.instagram, o.buyer.address, o.status, o.carrier]
          .join(" ")
          .toLowerCase()
          .includes(query),
  );

  const title = records.isIsolated && records.activeCustomer ? `Orders · ${records.activeCustomer.name}` : "Orders";
  const description =
    records.isIsolated && records.activeCustomer
      ? `Live from the shop database for ${records.activeCustomer.name} (today = ${records.today}). Isolated account: only this customer's orders and contact history are loaded.`
      : `Live from the shop database (today = ${records.today}). Each order belongs to one customer, and only the inbox accounts shown under the buyer get its details without extra verification.`;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-12 sm:px-6">
      <PageHeader title={title} description={description} />

      <OrderCustomerBanner
        customer={records.activeCustomer}
        orderCount={records.orders.length}
        isIsolated={records.isIsolated}
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
              <th className="px-4 py-2.5 font-medium">Items</th>
              <th className="px-4 py-2.5 font-medium">Buyer</th>
              <th className="px-4 py-2.5 font-medium">Contact on file</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Placed</th>
              <th className="px-4 py-2.5 text-right font-medium">Delivered / due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {orders.map((o) => (
              <tr key={o.id} className="align-top hover:bg-sunken/60">
                <td className="px-4 py-3 font-mono font-medium text-ink">#{o.id}</td>
                <td className="min-w-64 px-4 py-3 text-ink">
                  <div className="flex items-start gap-3">
                    <ProductThumbs images={o.images} size={40} />
                    <div>
                      <div>{o.items}</div>
                      <div className="text-xs text-muted tabular-nums">€{o.total.toFixed(2)}</div>
                    </div>
                  </div>
                </td>
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
                  {o.buyer.phone && <div>{o.buyer.phone}</div>}
                  {o.buyer.email && <div>{o.buyer.email}</div>}
                  {o.buyer.instagram && <div>{o.buyer.instagram}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-ink-2">
                    <span className={`size-1.5 rounded-full ${STATUS[o.status]?.dot ?? "bg-faint"}`} />
                    {STATUS[o.status]?.label ?? o.status}
                  </span>
                  {o.carrier && (
                    <div className="mt-0.5 text-xs text-muted">
                      {o.carrier} · {o.tracking?.replaceAll("_", " ")}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap text-ink-2 tabular-nums">{o.placedDaysAgo}d ago</td>
                <td className="px-4 py-3 text-right whitespace-nowrap text-ink-2 tabular-nums">
                  {o.deliveredDaysAgo !== undefined ? (
                    `${o.deliveredDaysAgo}d ago`
                  ) : o.expectedBy ? (
                    <span className="text-muted">due {o.expectedBy}</span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted">
                  {records.isIsolated && records.activeCustomer
                    ? `No orders found for ${records.activeCustomer.name}. This account currently has no purchase history in the database.`
                    : "No orders match."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 mb-3 text-sm font-semibold">
        {records.isIsolated && records.activeCustomer ? `Conversations · ${records.activeCustomer.name}` : "Conversations"}
      </h2>
      <p className="mb-3 text-sm text-muted">
        {records.isIsolated && records.activeCustomer
          ? `Inbox messages sent by ${records.activeCustomer.name}. The support agent consults this history to detect unanswered inquiries and enforce repeat-contact rules.`
          : "Every inbox message and what the agent did with it (the conversations, agent_log and escalations tables). A message with no agent_log row counts as unanswered; two or more in 14 days make the customer a repeat contact, which always escalates."}
      </p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="border-b border-line bg-sunken text-xs text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="px-4 py-2.5 font-medium">Channel</th>
              <th className="px-4 py-2.5 font-medium">Message</th>
              <th className="px-4 py-2.5 font-medium">Agent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {records.conversations.map((c) => (
              <tr key={c.id} className="align-top">
                <td className="px-4 py-3 text-ink">{c.who}</td>
                <td className="px-4 py-3 whitespace-nowrap text-ink-2">{c.daysAgo === 0 ? "today" : `${c.daysAgo}d ago`}</td>
                <td className="px-4 py-3 text-ink-2 capitalize">{c.channel}</td>
                <td className="px-4 py-3 text-ink-2">
                  {c.message}
                  {c.sentiment === "angry" && <span className="ml-1.5 text-xs font-medium text-bad">angry</span>}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-ink-2">
                  {c.answered ? (ACTION[c.action ?? ""] ?? c.action) : <span className="font-medium text-bad">Unanswered</span>}
                  {c.escalation && <div className="text-xs text-muted">ticket {c.escalation.replaceAll("_", " ")}</div>}
                </td>
              </tr>
            ))}
            {records.conversations.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  {records.isIsolated && records.activeCustomer
                    ? `No previous contact history recorded for ${records.activeCustomer.name}.`
                    : "No conversations recorded."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
