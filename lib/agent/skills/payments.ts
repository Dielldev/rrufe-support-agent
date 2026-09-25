import type { Skill } from "./index";

/**
 * Purchase plans and refunds, from .claude/skills/purchase-plans-refunds/SKILL.md.
 * Only rules in the policies table are applied; the rest goes to staff.
 */
export const payments: Skill = {
  name: "payments",
  description: "Payments, installments, refunds",
  instructions: `
- "Can I buy X in installments?": installments apply to any product, so answer from the installments policy first; look up the product only if they ask about its price or stock. Payment methods and installments: quote the policy exactly. Never quote interest, monthly amounts or approval odds. Other bank, >12 months, switching an order to installments, or an unlisted payment method → explain, then request_human.
- Refunds and refund timing: not decided by you; explain what you know, then request_human. Cancelling before shipping follows "Changing an order".
- The delay voucher is not cash and not a refund.
`.trim(),
};
