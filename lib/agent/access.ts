import type { Order } from "@/lib/db/repo";
import { checkIdentity, type IdentityCheck } from "@/lib/engine/facts";
import type { PolicyBook } from "@/lib/shop/policies";
import type { AccessScope, Sender, Signals } from "@/lib/engine/types";

/*
 * What this conversation is allowed to read, decided by code BEFORE the agent
 * runs. The agent never sees or sets any of it: every tool closes over the grant,
 * and no tool accepts a customer id, so "look up customer 2" isn't something the
 * model can even express.
 *
 * Identity comes from the inbox platform (the Viber number, the email From:
 * address, the Instagram account), never from what the message text claims.
 */

export interface AccessGrant {
  sender: Sender;
  /** Code-extracted reading of the message: third-party claim, stated email/phone, box-opened claim… */
  signals: Signals;
  /** The customer account whose data this conversation may read. Unset = no account access. */
  accountId?: string;
  level: AccessScope;
  /** Plain-language explanation shown in the Why panel and given to the agent. */
  note: string;
  now: Date;
  /** Shop calendar day (UTC midnight) for all day arithmetic. */
  today: Date;
  policies: PolicyBook;
}

export function grantAccess(input: {
  sender: Sender;
  signals: Signals;
  now: Date;
  today: Date;
  policies: PolicyBook;
}): AccessGrant {
  const { sender, signals } = input;
  const base = { ...input };
  if (signals.thirdParty.hit) {
    return {
      ...base,
      level: "public",
      note:
        "The writer says they are acting for someone else, so no customer's orders or contact details can be read in this conversation — only the catalog and the written policy.",
    };
  }
  if (sender.customerId) {
    return {
      ...base,
      accountId: sender.customerId,
      level: "account",
      note: `${sender.channel} ${sender.handle} is linked to customer #${sender.customerId} by the inbox platform. Their own orders and contact details can be read; nobody else's.`,
    };
  }
  if (signals.statedEmails.length && signals.statedPhones.length) {
    return {
      ...base,
      level: "per_order",
      note:
        "The sender isn't linked to a customer account. A single order opens only if the email AND phone written in this message both match that order's buyer.",
    };
  }
  return {
    ...base,
    level: "public",
    note:
      "The sender isn't linked to a customer account, so only the catalog and the written policy are available. An order opens if they write from the phone/email used on it, or send both its email and phone.",
  };
}

export type OrderAccess = { ok: true; identity: IdentityCheck } | { ok: false; reason: "third_party" | "not_owner" };

/**
 * May this conversation read this order? Same check the rules use (R3): the
 * linked account, a channel match, or both stated email and phone — and never
 * for someone who said they're writing for another person.
 */
export function orderAccess(grant: AccessGrant, order: Order): OrderAccess {
  if (grant.signals.thirdParty.hit) return { ok: false, reason: "third_party" };
  const identity = checkIdentity(order, grant.sender, grant.signals);
  if (grant.accountId && identity.method === "stated_email_and_phone") return { ok: false, reason: "not_owner" };
  return identity.verified ? { ok: true, identity } : { ok: false, reason: "not_owner" };
}
