import { CONTACT_LOG, SENDERS } from "@/lib/data/customers";
import { allOrders } from "@/lib/data/orders";
import { POLICY_CATALOG, UNCOVERED_TOPICS } from "@/lib/data/shop";
import { ordersOfSender } from "@/lib/engine/facts";
import { daysBetween } from "@/lib/engine/text";

/** Plain, serializable view of the mock records for the "ground truth" panel. */
export function shopRecords(now: Date) {
  return {
    orders: allOrders(now).map((o) => ({
      id: o.id,
      /** Inbox accounts the agent treats as this order's buyer. */
      linked: SENDERS.filter((s) => ordersOfSender(s, now).some((x) => x.id === o.id)).map((s) => ({
        channel: s.channel,
        handle: s.handle,
      })),
      buyer: o.buyer,
      item: o.item.name,
      status: o.status,
      placedDaysAgo: daysBetween(o.placedAt, now),
      deliveredDaysAgo: o.deliveredAt ? daysBetween(o.deliveredAt, now) : undefined,
    })),
    policies: POLICY_CATALOG,
    gaps: UNCOVERED_TOPICS.map((t) => t.label),
    contactLog: Object.entries(CONTACT_LOG).map(([senderId, entries]) => ({
      sender: SENDERS.find((s) => s.id === senderId)?.displayName ?? senderId,
      entries,
    })),
  };
}

export type ShopRecords = ReturnType<typeof shopRecords>;
