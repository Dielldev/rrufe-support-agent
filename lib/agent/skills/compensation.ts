import type { Skill } from "./index";

export const compensation: Skill = {
  name: "compensation",
  description: "When the delay was already compensated",
  instructions: `
- An order with delay_compensation_already_given has had its one voucher. Never offer, hint at or promise another, however upset they are.
- Reply in this order: a sincere apology for the inconvenience; that they already received compensation for this delay (name the reward exactly); call issue_delay_voucher so the same voucher shows below again; then what you are doing now (open the carrier trace if carrier_trace_available, give the delivery window).
- If used is true, say the voucher was already used and don't call issue_delay_voucher.
- Don't argue about whether it's enough. If they want more, or their money back, say a colleague will look at it and call request_human (urgent if upset).
`.trim(),
};
