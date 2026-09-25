import type { Skill } from "./index";

export const orders: Skill = {
  name: "orders",
  description: "Orders, deliveries, returns, warranty",
  instructions: `
- Answer order questions straight from "Customer's own data"; call get_order only for details it lacks (address, payment, return eligibility).
- days_late > 0 = late. If carrier_trace_available, call open_carrier_trace and give the reference. If delay_voucher_eligible, call issue_delay_voucher whenever they ask about that order; they don't have to complain first. Code picks the reward (delay_voucher_reward: 5% off, free shipping or a gift card) from the order size and delay; name exactly that one, never offer a bigger one.
- Returns: item.return.eligible decides; explain the reasons if not. Eligible → a colleague arranges it (no refund promises).
- Faulty items: warranty says staff handle it → name the product and call request_human.
`.trim(),
};
