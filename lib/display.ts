import { findCustomer, listConversations, listOrders, listSenders, ordersOfCustomer } from "@/lib/db/repo";
import { SHOP_TIME_ZONE, shopNow } from "@/lib/shop/operations";
import { calendarDay, daysBetween, isoDay } from "@/lib/engine/text";

/** Plain, serializable view of the database for the Orders page, optionally isolated to a customer. */
export async function shopRecords(now: Date = shopNow(), customerId?: string) {
  const today = calendarDay(now, SHOP_TIME_ZONE);
  const isIsolated = Boolean(customerId && customerId !== "all");
  const [orders, senders, conversations, customer] = await Promise.all([
    isIsolated ? ordersOfCustomer(customerId!) : listOrders(),
    listSenders(),
    listConversations(today, 60, isIsolated ? customerId : undefined),
    isIsolated ? findCustomer(customerId!) : Promise.resolve(undefined),
  ]);
  return {
    today: isoDay(today),
    activeCustomer: customer,
    isIsolated,
    orders: orders.map((o) => ({
      id: o.id,
      /** Inbox accounts the agent treats as this order's buyer. */
      linked: senders.filter((s) => s.customerId === o.customerId).map((s) => ({ channel: s.channel, handle: s.handle })),
      buyer: o.buyer,
      items: o.items.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}${i.opened ? " (opened)" : ""}`).join(", "),
      total: o.items.reduce((sum, i) => sum + i.qty * i.price, 0),
      status: o.status,
      carrier: o.shipment?.carrier,
      tracking: o.shipment?.tracking,
      expectedBy: o.shipment ? isoDay(o.shipment.expectedMax) : undefined,
      placedDaysAgo: daysBetween(o.placedAt, today),
      deliveredDaysAgo: o.deliveredAt ? daysBetween(o.deliveredAt, today) : undefined,
    })),
    conversations: conversations.map((c) => ({
      id: c.convId,
      who: c.customer ?? `${c.handle} (unknown)`,
      channel: c.channel,
      daysAgo: c.daysAgo,
      message: c.summary,
      sentiment: c.sentiment,
      answered: c.answered,
      action: c.action,
      escalation: c.escalation,
    })),
  };
}

export type ShopRecords = Awaited<ReturnType<typeof shopRecords>>;
