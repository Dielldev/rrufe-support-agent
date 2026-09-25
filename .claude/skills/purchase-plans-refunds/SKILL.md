---
name: purchase-plans-refunds
description: Rrufe Electronics policy for purchase plans (installments and payment methods) and refunds in general (returns, cancellations, defective or damaged items, late-delivery compensation, how and when money goes back). Use this whenever you answer or draft a reply to a customer asking to pay over time, pay by card, cash or bank transfer, cancel an order, return something, get their money back, or ask about a refund's status. Also use it when deciding whether such a request can be answered automatically or must go to staff, or when adding or changing a payment or refund rule in the shop database or the agent code, even if the customer only says "këste", "kthim", "rimbursim", "paratë mbrapsht" or "money back".
---

# Purchase plans and refunds policy

Rrufe Electronics, Pristina. This file covers **how customers can pay** and **when and how they get money back**. It's written for two readers:

- **People** (staff, teammates): read it as the policy document.
- **Claude Code**: this file lives at `.claude/skills/purchase-plans-refunds/SKILL.md`, so it loads automatically when these topics come up while working on the project.

The inbox agent itself follows the same rules through `lib/agent/skills/payments.ts`, `recovery.ts` and `handoff.ts`, and reads the live `policies` table on every message.

## Status of each rule

The inbox agent only acts on rules stored in the `policies` table. Each rule below is marked:

- **ON FILE**: in the database today (`db/seed.sql` or `db/extensions.sql`). The agent applies it.
- **PROPOSED**: a recommendation that is **not** in the database yet. Until the shop owner approves it and it's added (see "Adding a proposed rule"), the agent must not promise it and hands the question to staff.

Never present a PROPOSED rule to a customer as if it were shop policy. An invented refund promise costs the shop real money and trust. Check what's live (from the project folder):

```bash
node -e "require('@libsql/client').createClient({url:'file:db/shop.db'}).execute('SELECT topic, rule_text FROM policies').then(r=>console.table(r.rows))"
```

The Policies page in the app (`/policies`) shows the same table.

---

## 1. Purchase plans: how customers can pay

### Payment methods (ON FILE, topic `payments`)

> We accept card, bank transfer and cash on delivery.

These match `orders.payment_method` in the schema. Anything else (crypto, PayPal, cheques, paying in person later) isn't supported, so hand it to staff rather than saying no outright; they may make an exception.

### Installments (ON FILE, topic `installments`)

> Installments are available: 3, 6 or 12 monthly payments with a Raiffeisen Bank or TEB card, in store or at online checkout. Approval and any interest are set by the bank.

How to apply it:

- **Answer yes, with exactly these options**: 3, 6 or 12 months, a Raiffeisen Bank or TEB card, in store or online.
- **Never quote** interest rates, monthly amounts, approval chances or card requirements. The bank decides those. Point the customer to their bank.
- **Escalate to staff** when the customer:
  - has a card from another bank, or no card at all
  - wants more than 12 months
  - wants to combine installments with the delay voucher
  - wants to switch an existing order to installments

### PROPOSED: purchase-plan rules to approve

| # | Proposed rule | Why it's needed |
|---|---|---|
| P1 | Installments apply to the whole order, not to single items in a mixed order. | Customers will ask; nothing covers it today. |
| P2 | An order can be moved to installments only before it ships. | After shipping, payment is already settled with the bank. |

---

## 2. Refunds and returns

### What's ON FILE

| Topic | Rule | What it means in practice |
|---|---|---|
| `returns` | Returns are accepted within **30 days from delivery**, and the item must be **unopened**. | The count starts on the delivery date (the day the shipment was marked delivered), not the order date, and day 30 still counts. Both conditions must hold. "Opened" comes from the order record, or from the customer saying so. Computed in `lib/agent/views.ts` (`returnView`). |
| `warranty` | Defective items are handled by a human staff member. | The agent never diagnoses, refunds or replaces a broken item. It names the product and asks what's wrong, then escalates. |
| `delay_compensation` | A verified customer whose order is late or held by the carrier gets **5% off their next order**, valid 30 days. One voucher per delayed order. | This is a **voucher, not a refund**: no cash, not transferable, not combined with other vouchers. Issued by code only (`issue_delay_voucher` tool → `vouchers` table, one row per order). The customer sees it on an orange voucher card. |
| `privacy` | Order details are shared only with the verified account owner. | Refund status, amounts and order contents go only to the buyer, verified by their Viber number, email or Instagram handle on the order. |

### How the voucher can't be abused

- Only the verified owner of the order can get it (same ownership check as every order lookup).
- Only when code says the order is late right now, or held by the carrier (`delay_voucher_eligible`).
- One per order, enforced by `UNIQUE (order_id)` on the `vouchers` table. Asking again shows the same voucher.
- The percentage and validity come from the policy row, capped at 20% in `lib/shop/policies.ts`; the model can't choose them.
- Codes are random (`RRUFE5-XXXX-XXXX`), so they can't be guessed.

### PROPOSED: refund rules to approve

| # | Proposed rule | Why it's needed |
|---|---|---|
| R1 | **Refund method**: money goes back the way it was paid. Card → same card. Bank transfer → same account. Cash on delivery → bank transfer to an account the customer gives staff. | "How do I get my money back?" is the most common follow-up to an approved return. |
| R2 | **Refund timing**: the shop issues the refund within **14 days** of receiving the returned item and confirming it's unopened. The bank may take a few extra days to show it. | Customers ask "when?". Today the agent can only say staff will follow up. |
| R3 | **Installment purchases**: the shop refunds through the bank, which cancels the remaining installments. The bank sets the timing. | Refunding an installment purchase in cash would overpay the customer. |
| R4 | **Cancel before shipping**: an order still `pending` or `processing` can be cancelled for a full refund. Once `shipped`, the returns rule applies. | Clear, and cheap for the shop. |
| R5 | **Damaged in transit or wrong item**: reported within **48 hours of delivery** with a photo, it's replaced or fully refunded **even if opened**. Staff handle it. | "Unopened" can't fairly apply when the customer had to open the box to discover the problem. |
| R6 | **Delivery charges** are refunded only when the shop is at fault (R5, defective items, lost parcels). | Nothing in the database covers shipping fees yet. |

The day counts in R2 and R5 are suggestions; the owner sets the final numbers. Before publishing any refund rule to customers, check it against Kosovo's consumer-protection rules for distance sales, especially the "unopened" condition for online orders.

---

## 3. Who decides what

Target: a person sees about **1 in 100** conversations. The agent solves everything it can.

**The agent may do alone**, because these are information, not money movement:

- explain the installment options and payment methods
- tell a verified buyer whether an item is eligible for return under the 30-day / unopened rule
- politely decline a return that fails the rule, giving the reason
- trace a late parcel and issue the 5% delay voucher (code-issued, capped by policy)
- calm an upset or repeat customer by fixing what can be fixed (it no longer hands them off just for being upset)
- ask an unknown sender to verify, or decline a third party

**Staff must handle**, because these move money, can't be undone, or aren't on file:

- actually processing any refund, reversal, cancellation or installment change
- defective, damaged or wrong items
- any exception to a rule ("it's 32 days but I was abroad")
- refund status or timing questions, until R2 is approved
- anything in a PROPOSED row, until it's approved and added

Escalate **high priority** when the customer has written before without an answer, or is clearly upset.

### Quick decision table

| The customer… | Verified owner? | The agent… |
|---|---|---|
| asks if they can pay in installments | not needed | answers from the installments rule |
| wants to return an unopened item, ≤ 30 days after delivery | yes | confirms it's eligible; the refund itself is done by staff |
| wants to return an opened item, or > 30 days after delivery | yes | declines politely with the reason |
| says the item is broken or doesn't work | yes | names the product, asks what's wrong, escalates (warranty) |
| is upset that the order is late | yes | explains the delay, opens a trace, gives the 5% voucher |
| wants a refund because the order is late | yes | as above; a cash refund request goes to staff |
| wants to cancel an order that hasn't shipped | yes | escalates (R4 not on file yet) |
| asks when their refund will arrive | yes | escalates (R2 not on file yet) |
| asks any of the above about an order | no | asks for the email or phone used on the order first |
| asks about someone else's order or refund | n/a | declines: not authorized to share |

---

## 4. Reply wording

Reply in the customer's language, in 2–4 short sentences, warmly, with no promises that aren't on file. Don't give timelines, amounts or percentages unless a rule above states them.

**Installments: yes**

- EN: "Yes, you can! You can pay in 3, 6 or 12 monthly installments with a Raiffeisen Bank or TEB card, in store or at online checkout. Approval and any interest are set by the bank."
- SQ: "Po, mundeni! Mund të paguani me 3, 6 ose 12 këste mujore me kartelë të Raiffeisen Bank ose TEB, në dyqan ose gjatë pagesës online. Miratimi dhe interesi, nëse ka, përcaktohen nga banka."

**Installments: outside the rule** (other bank, longer term)

- EN: "Thanks for asking. That option isn't covered by our current installment plans, so I've passed your question to our team and they'll get back to you."
- SQ: "Faleminderit për pyetjen. Ky opsion nuk mbulohet nga planet tona aktuale me këste, ndaj pyetjen tuaj ia kemi kaluar ekipit tonë dhe ata do t'ju përgjigjen."

**Return declined**

- EN: "I'm sorry, {name}, but your {product} can't be returned: it was delivered {n} days ago and it has been opened. Our policy accepts returns within 30 days of delivery, and the item must be unopened."
- SQ: "Na vjen keq, {emri}, por {produkti} nuk mund të kthehet: kanë kaluar {n} ditë nga dorëzimi dhe është hapur. Sipas politikës sonë, kthimet pranohen brenda 30 ditëve nga dorëzimi, nëse artikulli nuk është hapur."

**Return eligible** (staff take it from here)

- EN: "Good news: your {product} is eligible for return. It was delivered {n} days ago and is unopened. A team member will contact you with the next steps."
- SQ: "Lajm i mirë: {produkti} mund të kthehet. Kanë kaluar {n} ditë nga dorëzimi dhe nuk është hapur. Një anëtar i ekipit do t'ju kontaktojë për hapat e mëtejshëm."

**Late order, upset customer**

- EN: "I'm sorry, {name} — order #{id} is {n} days late. I've asked the courier to trace it (reference {trace}). For the wait, there's a 5% voucher for your next order below."
- SQ: "Na vjen keq, {emri} — porosia #{id} është {n} ditë me vonesë. I kërkova korrierit ta gjurmojë (referenca {trace}). Për pritjen, më poshtë keni një kupon 5% për porosinë e ardhshme."

**Refund question with no rule on file** (timing, method, cancellation)

- EN: "Thanks for your message. I've passed your refund question to our team so they can give you an exact answer, and a team member will follow up with you personally."
- SQ: "Faleminderit për mesazhin. Pyetjen tuaj për rimbursimin ia kemi kaluar ekipit tonë që t'ju japë një përgjigje të saktë, dhe një anëtar i ekipit do t'ju kontaktojë personalisht."

**The voucher is not cash**

- EN: "The 5% discount is a voucher for your next order, so it can't be paid out in cash. If you'd like to discuss a refund for this order, I've passed your request to our team."
- SQ: "Zbritja 5% është kupon për porosinë e ardhshme dhe nuk mund të paguhet në para. Nëse dëshironi të diskutoni rimbursimin për këtë porosi, kërkesën tuaj ia kemi kaluar ekipit tonë."

**Never say:** a refund amount or date that isn't on file; "you'll get your money back" before staff approve it; interest rates or monthly payments; a second discount; anything about another person's order.

---

## 5. Adding a proposed rule

Once the owner approves a rule (say R2), add it so the agent can use it:

1. **Database.** Add a row to `db/extensions.sql`, so it survives a rebuild:

   ```sql
   INSERT INTO policies (topic, rule_text, value) VALUES
   ('refund_timing',
    'Refunds are issued within 14 days of receiving the returned item and confirming it is unopened.',
    '{"days":14}')
   ON CONFLICT (topic) DO NOTHING;
   ```

   Then bump `SCHEMA_VERSION` in `lib/db/client.ts`, so existing databases apply the file once more on the next start. Or run `npm run db:reset` to rebuild from scratch.
2. **Agent.** Nothing else is needed for the agent to *quote* the rule: it reads every `policies` row on each message, and the output checks allow numbers and wording that appear in it. If the rule has to be *computed* (a deadline, an eligibility check), parse `value` in `lib/shop/policies.ts` and compute it in `lib/agent/views.ts` or a tool in `lib/agent/tools.ts`, so the model narrates a result instead of working it out.
3. **Rules-only mode** (no model keys). To answer without the agent, add a keyword detector in `lib/engine/topics.ts` (or an intent in `lib/engine/signals.ts`), a path in `lib/engine/rules.ts` and both-language templates in `lib/engine/templates.ts`.
4. **This file.** Change the rule's status from PROPOSED to ON FILE, and update `lib/agent/skills/payments.ts` if the agent's behaviour should change.
5. **Test.** Send a message that asks about the new rule, from a verified customer and from an unknown sender, and check the badge and the "Why?" panel. Add a case to `tests/agent.test.ts`.
