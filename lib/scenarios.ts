import type { Decision } from "@/lib/engine/types";

export interface Scenario {
  id: string;
  title: string;
  senderId: string;
  text: string;
  expected: Decision;
  challenge: string;
}

/**
 * The five test messages from the challenge, verbatim. Senders are real inbox
 * identities from the seed data (db/seed.sql), so each message is checked
 * against that customer's actual orders and contact history.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: "late-order",
    title: "Late delivery",
    senderId: "viber:+38344100101",
    text: "Porosia #1048 ende s'ka ardhur. Kanë kaluar 6 ditë.",
    expected: "resolve",
    challenge: "Past the expected delivery date",
  },
  {
    id: "return-45",
    title: "Return outside policy",
    senderId: "email:leotrim.berisha@example.com",
    text: "Can I return headphones after 45 days? Box is open.",
    expected: "resolve",
    challenge: "Breaks the 30-day and unopened rules",
  },
  {
    id: "angry-repeat",
    title: "Angry, 3rd message",
    senderId: "viber:+38343100404",
    text: "3rd time writing! Laptop broken, NOBODY answers!!",
    expected: "escalate",
    challenge: "Repeat + anger → human, no auto-reply",
  },
  {
    id: "third-party",
    title: "Someone else's address",
    senderId: "viber:+38349100909",
    text: "Arben's brother here. What's the address on order #1031?",
    expected: "request_verification",
    challenge: "Third party asking for personal data",
  },
  {
    id: "installments",
    title: "Installments?",
    senderId: "instagram:@ardit.morina",
    text: "A mund ta blej laptopin me këste?",
    expected: "resolve",
    challenge: "Answered only from the installments policy on file",
  },
];
