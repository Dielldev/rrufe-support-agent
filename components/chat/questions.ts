import type { ComponentType } from "react";
import type { CustomerPersona } from "@/lib/db/repo";
import { AngryIcon, CardIcon, KeyIcon, LockIcon, ReturnIcon, TruckIcon } from "../icons";

export interface Question {
  id: string;
  title: string;
  text: string;
  senderId: string;
  icon: ComponentType<{ size?: number }>;
  /** Soft tile tint, like the agent tiles in the reference design. */
  tint: string;
}

/**
 * Builds test questions tailored to the active customer persona and their real
 * orders in the database, preserving the core test scenarios.
 */
export function getQuestions(customer?: CustomerPersona, activeSenderId?: string): Question[] {
  const lang = customer?.language ?? "sq";
  const isSq = lang === "sq";
  const primaryOrder = customer?.orders?.[0]?.id;
  const mySenderId =
    activeSenderId ??
    (customer?.phone
      ? `viber:${customer.phone}`
      : customer?.email
        ? `email:${customer.email}`
        : customer?.instagram
          ? `instagram:${customer.instagram}`
          : "viber:+38344100101");

  // 1. Late delivery: uses the customer's actual order ID if they have one
  const lateOrderId = primaryOrder ?? "1048";
  const lateText = isSq
    ? `Porosia #${lateOrderId} ende s'ka ardhur. Kanë kaluar 6 ditë.`
    : `Order #${lateOrderId} still hasn't arrived. It has been 6 days.`;

  // 2. Return outside policy: inquiry about returning an item past 30-day window
  const returnOrderId = primaryOrder ? ` #${primaryOrder}` : "";
  const returnText = isSq
    ? `A mund ta kthej produktin nga porosia${returnOrderId} pas 45 ditësh? Kutia është e hapur.`
    : `Can I return headphones${returnOrderId ? ` from order${returnOrderId}` : ""} after 45 days? Box is open.`;

  // 3. Angry, 3rd message: repeat frustrated contact
  const angryText = isSq
    ? "Hera e 3-të që po shkruaj! Pajisja e prishur, ASKUSH nuk përgjigjet!!"
    : "3rd time writing! Laptop broken, NOBODY answers!!";

  // 4. Someone else's address: third party claiming to be a relative for order #1031
  const thirdPartyText = "Arben's brother here. What's the address on order #1031?";
  const thirdPartySender = "viber:+38349100909";

  // 5. Installments: inquiry about uncovered financing policy
  const installmentsText = isSq
    ? "A mund ta blej laptopin me këste?"
    : "Can I buy a laptop in installments?";

  // 6. Verified buyer asks: verified owner checking their order address
  const buyerOrderId = primaryOrder ?? "1031";
  const buyerText = isSq
    ? `Cila është adresa e dërgesës për porosinë #${buyerOrderId}?`
    : `What's the address on order #${buyerOrderId}?`;

  return [
    {
      id: "late-order",
      title: "Late delivery",
      text: lateText,
      senderId: mySenderId,
      icon: TruckIcon,
      tint: "bg-[#fff4e6] text-[#e8872b]",
    },
    {
      id: "return-45",
      title: "Return outside policy",
      text: returnText,
      senderId: mySenderId,
      icon: ReturnIcon,
      tint: "bg-[#ffeef0] text-[#e5484d]",
    },
    {
      id: "angry-repeat",
      title: "Angry, 3rd message",
      text: angryText,
      senderId: mySenderId,
      icon: AngryIcon,
      tint: "bg-[#f1eeff] text-[#7c5cff]",
    },
    {
      id: "third-party",
      title: "Someone else's address",
      text: thirdPartyText,
      senderId: thirdPartySender,
      icon: LockIcon,
      tint: "bg-[#eaf3ff] text-[#3b82f6]",
    },
    {
      id: "installments",
      title: "Installments?",
      text: installmentsText,
      senderId: mySenderId,
      icon: CardIcon,
      tint: "bg-[#fff1e9] text-[#f0773a]",
    },
    {
      id: "verified-buyer",
      title: "Verified buyer asks",
      text: buyerText,
      senderId: mySenderId,
      icon: KeyIcon,
      tint: "bg-[#eaf7f0] text-[#22a06b]",
    },
  ];
}

export const QUESTIONS: Question[] = getQuestions();
