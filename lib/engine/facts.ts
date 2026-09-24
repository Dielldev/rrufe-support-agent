import { contactLogFor, type ContactLogEntry } from "@/lib/data/customers";
import { allOrders, findOrder, type Order } from "@/lib/data/orders";
import { normEmail, normPhone } from "./text";
import type { Sender, Signals, ThreadMessage } from "./types";

/*
 * Facts come from code and mock records only. The customer's own claims are
 * kept separately and never override a record.
 */

export interface IdentityCheck {
  verified: boolean;
  method?: "linked_account" | "channel_phone" | "channel_email" | "stated_email_and_phone";
  channelMatch: boolean;
  statedEmailMatch: boolean;
  statedPhoneMatch: boolean;
  thirdParty: boolean;
}

export type OrderMatch = "by_id" | "from_thread" | "by_sender_product" | "by_sender_recent" | "id_not_found" | "none";

export interface FactSheet {
  now: Date;
  order?: Order;
  orderMatch: OrderMatch;
  requestedOrderId?: string;
  senderOrders: Order[];
  identity?: IdentityCheck;
  history: {
    log: ContactLogEntry[];
    unanswered14d: number;
    sessionUnresolved: number;
  };
}

export function ordersOfSender(sender: Sender, now: Date): Order[] {
  return allOrders(now).filter(
    (o) =>
      (sender.customerId && o.customerId === sender.customerId) ||
      (sender.email && normEmail(o.buyer.email) === normEmail(sender.email)) ||
      (sender.phone && normPhone(o.buyer.phone) === normPhone(sender.phone)),
  );
}

export function checkIdentity(order: Order, sender: Sender, signals: Signals): IdentityCheck {
  const linked = Boolean(sender.customerId && sender.customerId === order.customerId);
  const channelPhone = Boolean(sender.phone && normPhone(sender.phone) === normPhone(order.buyer.phone));
  const channelEmail = Boolean(sender.email && normEmail(sender.email) === normEmail(order.buyer.email));
  const statedEmailMatch = signals.statedEmails.some((e) => normEmail(e) === normEmail(order.buyer.email));
  const statedPhoneMatch = signals.statedPhones.some((p) => normPhone(p) === normPhone(order.buyer.phone));
  const thirdParty = signals.thirdParty.hit;

  // Someone who says they are writing for another person is never the buyer,
  // even if they happen to know the buyer's contact details.
  let method: IdentityCheck["method"];
  if (!thirdParty) {
    if (linked) method = "linked_account";
    else if (channelPhone) method = "channel_phone";
    else if (channelEmail) method = "channel_email";
    else if (statedEmailMatch && statedPhoneMatch) method = "stated_email_and_phone";
  }
  return {
    verified: method !== undefined,
    method,
    channelMatch: linked || channelPhone || channelEmail,
    statedEmailMatch,
    statedPhoneMatch,
    thirdParty,
  };
}

function mostRecent(orders: Order[]): Order | undefined {
  return [...orders].sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())[0];
}

export function gatherFacts(
  signals: Signals,
  sender: Sender,
  thread: ThreadMessage[],
  now: Date,
): FactSheet {
  const senderOrders = ordersOfSender(sender, now);
  let order: Order | undefined;
  let orderMatch: OrderMatch = "none";
  const requestedOrderId = signals.orderIds[0] ?? signals.contextOrderId;

  if (requestedOrderId) {
    order = findOrder(requestedOrderId, now);
    orderMatch = order ? (signals.orderIds[0] ? "by_id" : "from_thread") : "id_not_found";
  } else if (signals.product) {
    order = mostRecent(senderOrders.filter((o) => o.item.category === signals.product));
    if (order) orderMatch = "by_sender_product";
  }
  if (!order && orderMatch === "none") {
    order = mostRecent(senderOrders);
    if (order) orderMatch = "by_sender_recent";
  }

  const log = contactLogFor(sender.id);
  const unanswered14d = log.filter((e) => !e.answered && e.daysAgo <= 14).length;
  const sessionUnresolved = thread.filter(
    (m) => m.senderId === sender.id && m.decision !== undefined && m.decision !== "resolve",
  ).length;

  return {
    now,
    order,
    orderMatch,
    requestedOrderId,
    senderOrders,
    identity: order ? checkIdentity(order, sender, signals) : undefined,
    history: { log, unanswered14d, sessionUnresolved },
  };
}
