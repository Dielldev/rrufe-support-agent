import type { Channel, Sender } from "@/lib/engine/types";

/** Inbox identities. `email` / `phone` are what the platform verifies, not what the text claims. */
export const SENDERS: Sender[] = [
  {
    id: "blerta",
    customerId: "blerta",
    channel: "viber",
    handle: "+383 44 212 048",
    displayName: "Blerta H.",
    phone: "+383 44 212 048",
  },
  {
    id: "leon",
    customerId: "leon",
    channel: "email",
    handle: "leon.berisha@example.com",
    displayName: "Leon Berisha",
    email: "leon.berisha@example.com",
  },
  {
    id: "gentrit",
    customerId: "gentrit",
    channel: "email",
    handle: "gentrit.morina@example.com",
    displayName: "Gentrit Morina",
    email: "gentrit.morina@example.com",
  },
  { id: "dren", customerId: "dren", channel: "instagram", handle: "@dren.gashi", displayName: "Dren G." },
  {
    id: "albina",
    customerId: "albina",
    channel: "viber",
    handle: "+383 49 555 310",
    displayName: "Albina",
    phone: "+383 49 555 310",
  },
  {
    id: "arben",
    customerId: "arben",
    channel: "viber",
    handle: "+383 44 731 031",
    displayName: "Arben Gashi",
    phone: "+383 44 731 031",
  },
  {
    id: "vjosa",
    customerId: "vjosa",
    channel: "email",
    handle: "vjosa.krasniqi@example.com",
    displayName: "Vjosa Krasniqi",
    email: "vjosa.krasniqi@example.com",
  },
  { id: "driton", customerId: "driton", channel: "viber", handle: "+383 45 660 039", displayName: "Driton K.", phone: "+383 45 660 039" },
  { id: "guest", channel: "instagram", handle: "@new.customer", displayName: "New contact" },
];

export function findSender(id: string): Sender | undefined {
  return SENDERS.find((s) => s.id === id);
}

export interface ContactLogEntry {
  daysAgo: number;
  channel: Channel;
  summary: string;
  answered: boolean;
}

/** Earlier contacts per sender, as the shop's inbox recorded them. */
export const CONTACT_LOG: Record<string, ContactLogEntry[]> = {
  gentrit: [
    {
      daysAgo: 4,
      channel: "email",
      summary: "Laptop won't power on after a Windows update — asked for help.",
      answered: false,
    },
    {
      daysAgo: 2,
      channel: "instagram",
      summary: "Asked for an update on the broken laptop.",
      answered: false,
    },
  ],
};

export function contactLogFor(senderId: string): ContactLogEntry[] {
  return CONTACT_LOG[senderId] ?? [];
}
