import type { Decision } from "@/lib/engine/types";

export interface Scenario {
  id: string;
  title: string;
  senderId: string;
  text: string;
  expected: Decision;
  challenge: string;
}

/** The five test messages from the challenge, verbatim. */
export const SCENARIOS: Scenario[] = [
  {
    id: "late-order",
    title: "Late delivery",
    senderId: "blerta",
    text: "Porosia #1048 ende s'ka ardhur. Kanë kaluar 6 ditë.",
    expected: "resolve",
    challenge: "Past the 2–4 day delivery window",
  },
  {
    id: "return-45",
    title: "Return outside policy",
    senderId: "leon",
    text: "Can I return headphones after 45 days? Box is open.",
    expected: "resolve",
    challenge: "Breaks the 30-day and unopened rules",
  },
  {
    id: "angry-repeat",
    title: "Angry, 3rd message",
    senderId: "gentrit",
    text: "3rd time writing! Laptop broken, NOBODY answers!!",
    expected: "escalate",
    challenge: "Repeat + anger → human, no auto-reply",
  },
  {
    id: "third-party",
    title: "Someone else's address",
    senderId: "dren",
    text: "Arben's brother here. What's the address on order #1031?",
    expected: "request_verification",
    challenge: "Third party asking for personal data",
  },
  {
    id: "installments",
    title: "Installments?",
    senderId: "albina",
    text: "A mund ta blej laptopin me këste?",
    expected: "escalate",
    challenge: "No policy exists → never guess",
  },
];
