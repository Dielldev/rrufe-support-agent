import {
  contactLog,
  findOrder,
  handleMatchesBuyer,
  ordersOfCustomer,
  searchProducts,
  type ContactLogEntry,
  type Order,
  type Product,
} from "@/lib/db/repo";
import type { PolicyBook } from "@/lib/shop/policies";
import { SHOP_TIME_ZONE } from "@/lib/shop/operations";
import { calendarDay, normEmail, normPhone } from "./text";
import type { Sender, Signals, ThreadMessage } from "./types";

/*
 * Facts come from the shop database only. The customer's own claims are kept
 * separately and never override a record.
 */

export interface IdentityCheck {
  verified: boolean;
  method?: "linked_account" | "channel_phone" | "channel_email" | "channel_instagram" | "stated_email_and_phone";
  channelMatch: boolean;
  statedEmailMatch: boolean;
  statedPhoneMatch: boolean;
  thirdParty: boolean;
}

export type OrderMatch = "by_id" | "from_thread" | "by_sender_product" | "by_sender_recent" | "id_not_found" | "none";

export interface FactSheet {
  /** The instant the message is handled. */
  now: Date;
  /** Today's date in the shop's time zone, as a UTC midnight (all day arithmetic uses this). */
  today: Date;
  policies: PolicyBook;
  order?: Order;
  orderMatch: OrderMatch;
  requestedOrderId?: string;
  senderOrders: Order[];
  /** Catalog matches, looked up only for product questions. */
  products?: Product[];
  identity?: IdentityCheck;
  history: {
    log: ContactLogEntry[];
    unanswered: number;
    sessionUnresolved: number;
  };
}

export function checkIdentity(order: Order, sender: Sender, signals: Signals): IdentityCheck {
  const linked = Boolean(sender.customerId && sender.customerId === order.customerId);
  const buyer = order.buyer;
  const channelPhone = Boolean(sender.phone && buyer.phone && normPhone(sender.phone) === normPhone(buyer.phone));
  const channelEmail = Boolean(sender.email && buyer.email && normEmail(sender.email) === normEmail(buyer.email));
  const channelInstagram = sender.channel === "instagram" && handleMatchesBuyer(order, sender);
  const statedEmailMatch = Boolean(buyer.email && signals.statedEmails.some((e) => normEmail(e) === normEmail(buyer.email!)));
  const statedPhoneMatch = Boolean(buyer.phone && signals.statedPhones.some((p) => normPhone(p) === normPhone(buyer.phone!)));
  const thirdParty = signals.thirdParty.hit;

  // Someone who says they are writing for another person is never the buyer,
  // even if they happen to know the buyer's contact details.
  let method: IdentityCheck["method"];
  if (!thirdParty) {
    if (linked) method = "linked_account";
    else if (channelPhone) method = "channel_phone";
    else if (channelEmail) method = "channel_email";
    else if (channelInstagram) method = "channel_instagram";
    else if (statedEmailMatch && statedPhoneMatch && !sender.customerId) method = "stated_email_and_phone";
  }
  return {
    verified: method !== undefined,
    method,
    channelMatch: linked || channelPhone || channelEmail || channelInstagram,
    statedEmailMatch,
    statedPhoneMatch,
    thirdParty,
  };
}

function mostRecent(orders: Order[]): Order | undefined {
  return [...orders].sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime() || Number(b.id) - Number(a.id))[0];
}

export async function gatherFacts(
  signals: Signals,
  sender: Sender,
  thread: ThreadMessage[],
  now: Date,
  policies: PolicyBook,
): Promise<FactSheet> {
  const today = calendarDay(now, SHOP_TIME_ZONE);
  const requestedOrderId = signals.orderIds[0] ?? signals.contextOrderId;
  const wantsProducts = signals.intent.value === "product_search";
  const [senderOrders, log, requested, products] = await Promise.all([
    sender.customerId ? ordersOfCustomer(sender.customerId) : Promise.resolve([]),
    contactLog(sender, now, today),
    requestedOrderId ? findOrder(requestedOrderId) : Promise.resolve(undefined),
    wantsProducts ? searchProducts({ category: signals.product, maxPrice: signals.priceCap, limit: 6 }) : Promise.resolve(undefined),
  ]);

  let order: Order | undefined;
  let orderMatch: OrderMatch = "none";
  if (requestedOrderId) {
    order = requested;
    orderMatch = order ? (signals.orderIds[0] ? "by_id" : "from_thread") : "id_not_found";
  } else if (signals.product) {
    order = mostRecent(senderOrders.filter((o) => o.items.some((i) => i.category === signals.product)));
    if (order) orderMatch = "by_sender_product";
  }
  if (!order && orderMatch === "none") {
    order = mostRecent(senderOrders);
    if (order) orderMatch = "by_sender_recent";
  }

  const sessionUnresolved = thread.filter(
    (m) => m.senderId === sender.id && m.decision !== undefined && m.decision !== "resolve",
  ).length;

  return {
    now,
    today,
    policies,
    order,
    orderMatch,
    requestedOrderId,
    senderOrders,
    products,
    identity: order ? checkIdentity(order, sender, signals) : undefined,
    history: { log, unanswered: log.filter((e) => !e.answered).length, sessionUnresolved },
  };
}

/** The line item a message is about: the product mentioned, else the first item. */
export function focusItem(order: Order, product?: string) {
  return order.items.find((i) => i.category === product) ?? order.items[0];
}
