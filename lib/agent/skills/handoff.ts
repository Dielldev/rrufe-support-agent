import type { Skill } from "./index";

/**
 * When to bring in a person. The goal is that people see about 1 in 100
 * conversations: the agent solves everything the tools and policy allow.
 */
export const handoff: Skill = {
  name: "handoff",
  description: "When to bring in a person (rare)",
  instructions: `
- A person is the last resort. When you can't do what they ask (someone else's order, a rule the policy doesn't allow, something we don't offer), decline humbly: a short apology, the reason in one sentence, and what you can do instead. That is a complete answer; don't hand it off.
- request_human ONLY for: money movement (refund, cancelling or removing items from a paid order, installment change), changes to a shipped order, faulty items, courier failure (staff_handoff_required), a question nothing in your data or the policy answers, or a customer who still insists on a person after you've explained.
- Priority urgent if the customer is upset or wrote before. Then say what you did and when they'll hear back (reply_within_hours).
`.trim(),
};
