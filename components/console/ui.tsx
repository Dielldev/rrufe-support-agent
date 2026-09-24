import type { ReactNode } from "react";
import type { Decision } from "@/lib/engine/types";

/**
 * Deliberately quiet: every decision uses the same neutral surface and only a
 * small colored dot tells them apart.
 */
export const DECISION_STYLE: Record<
  Decision,
  { label: string; short: string; dot: string; text: string; bg: string; line: string; ring: string; blurb: string }
> = {
  resolve: {
    label: "Auto-resolved",
    short: "Resolve",
    dot: "bg-dot-ok",
    text: "text-ink",
    bg: "bg-sunken",
    line: "border-line-strong",
    ring: "ring-line-strong",
    blurb: "Answered from written policy and verified records.",
  },
  request_verification: {
    label: "Verification needed",
    short: "Verify",
    dot: "bg-dot-verify",
    text: "text-ink",
    bg: "bg-sunken",
    line: "border-line-strong",
    ring: "ring-line-strong",
    blurb: "Identity or order must be confirmed before anything is shared.",
  },
  escalate: {
    label: "Escalated to human",
    short: "Escalate",
    dot: "bg-dot-esc",
    text: "text-ink",
    bg: "bg-sunken",
    line: "border-line-strong",
    ring: "ring-line-strong",
    blurb: "A person takes over — no automated answer is attempted.",
  },
};

export function DecisionDot({ decision }: { decision: Decision }) {
  return <span className={`inline-block size-1.5 shrink-0 rounded-full ${DECISION_STYLE[decision].dot}`} />;
}

export function DecisionPill({ decision, size = "md" }: { decision: Decision; size?: "sm" | "md" }) {
  const s = DECISION_STYLE[decision];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface font-medium whitespace-nowrap text-ink-2 ${
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-0.5 text-xs"
      }`}
    >
      <DecisionDot decision={decision} />
      {size === "sm" ? s.short : s.label}
    </span>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
