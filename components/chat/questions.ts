import type { ComponentType } from "react";
import { SCENARIOS } from "@/lib/scenarios";
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

const LOOK: Record<string, Pick<Question, "icon" | "tint">> = {
  "late-order": { icon: TruckIcon, tint: "bg-[#fff4e6] text-[#e8872b]" },
  "return-45": { icon: ReturnIcon, tint: "bg-[#ffeef0] text-[#e5484d]" },
  "angry-repeat": { icon: AngryIcon, tint: "bg-[#f1eeff] text-[#7c5cff]" },
  "third-party": { icon: LockIcon, tint: "bg-[#eaf3ff] text-[#3b82f6]" },
  installments: { icon: CardIcon, tint: "bg-[#fff1e9] text-[#f0773a]" },
};

/** The five challenge messages, plus one that shows verification succeeding. */
export const QUESTIONS: Question[] = [
  ...SCENARIOS.map((s) => ({ id: s.id, title: s.title, text: s.text, senderId: s.senderId, ...LOOK[s.id] })),
  {
    id: "verified-buyer",
    title: "Verified buyer asks",
    text: "What's the address on order #1031?",
    senderId: "instagram:@arben.hoxha",
    icon: KeyIcon,
    tint: "bg-[#eaf7f0] text-[#22a06b]",
  },
];
