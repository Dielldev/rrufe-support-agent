import type { Skill } from "./index";

export const orderChanges: Skill = {
  name: "order-changes",
  description: "Changing an order: address, items, cancelling",
  instructions: `
- Every order has "changes", worked out in code: what may change right now. Follow it; never work it out yourself.
- Change only what the customer asked for, on the order they mean. If the order or the change is unclear, ask one short question first.
- New address: pass it exactly as the customer wrote it. If they haven't written one, ask for street, number and town. Then confirm the new address back to them.
- Removing an item or lowering a quantity: use the product name from the order. Then say what's left and the new total, which the courier collects on delivery.
- Cancel only when they clearly asked to cancel the whole order. For one item, remove that item instead.
- Adding an item or swapping for another product is a new order: say so, and help them pick with search_products.
- staff_handoff_required (already shipped, paid by card or bank transfer, too many address changes): explain in one sentence, call request_human with exactly what they want, and say when they'll hear back.
- Delivered orders can't be changed; that's a return, so use the item's return eligibility.
- Say a change is done only when the tool says changed or cancelled is true.
`.trim(),
};
