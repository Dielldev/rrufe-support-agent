# Support agent: architecture

The assistant used to be a classifier with fixed answers. A regex picked one of eleven intents, one hand-written function per intent built the answer, and a model only rephrased a template. Anything outside those paths went to a person.

It's now a tool-using agent that can answer anything the shop's records, catalog and written policy can answer. The intent layer stays as a security gate in front of it.

```
message
  │
  ├─ 1. Read signals            code      language, order numbers, mood, third-party claims, stated email/phone
  ├─ 2. Classifier proposes     Jev/Groq  typed intent + risk flags — runs IN PARALLEL with step 5
  ├─ 3. Rules + guard (GATE)    code      decides what only a person can do
  │        escalate ─────────────────────► handoff reply, the agent is stopped / never runs
  │        otherwise
  ├─ 4. Access grant            code      what this conversation may read (from the inbox identity)
  ├─ 5. Agent loop              model     ⇄ scoped tools, every call recorded in a ledger
  │                                       reply streamed sentence by sentence, each sentence checked first
  ├─ 6. Decision                code      strictest(gate, what the tools recorded)
  └─ 7. Output checks           code      one rewrite allowed, then the approved template (or an error in pure-AI mode)
```

## 1–3. The gate

The goal is that a person sees about **1 in 100** conversations. With an agent configured, the gate only hands off what the agent can't do:

- **R2 a known topic with no written policy** (trade-ins, price matching, business orders) **→ person.**
- **R5** faulty items (the warranty policy says staff handle them), courier failures that need re-delivery, and delivered parcels that can't be found **→ person.**
- **R3/R4** mark the conversation as needing verification. The agent still runs and helps with everything else; the tools enforce the same rule.

Everything else goes to the agent, including cases that used to escalate:

- **Anger or repeat contact (R1) no longer hands off by itself.** The mood evidence goes into the agent's instructions. The agent follows the `recovery` skill: fix it now (trace, voucher, straight answer), and hand off as urgent only if it can't.
- **Cancelled/returned orders and very late parcels.** The agent explains, traces and compensates; only money movement goes to staff.
- **Unrecognised questions.** The agent answers from tool results and policy, or calls `request_human`.
- **The classifier's decision is advisory** (guard outcome `advisory`). Its risk flags still count: a third-party flag narrows access, and mood flags inform the agent. But its "escalate" guess alone no longer sends anyone to staff. Without an agent, the guard works exactly as before.

With no agent model, all the old rules apply unchanged (R1 escalates, unknown questions escalate).

Two more changes: there's a new intent, **`product_search`**, because the catalog is public shop data. And three policies are now **on file** (`db/extensions.sql`): `installments`, `payments` and `delay_compensation`.

## 4. Access grant (`lib/agent/access.ts`)

Code decides what the conversation can reach before the model sees anything:

| Sender | Scope | Can read |
| --- | --- | --- |
| Inbox account linked to a customer | `account` | That customer's profile and orders |
| Unknown sender who states email **and** phone | `per_order` | One order, if both match its buyer |
| Unknown sender, or anyone who said "I'm writing for …" (sticks for the whole thread) | `public` | Catalog and policy only |

Identity comes from the channel (Viber number, email From: address, Instagram account), never from the message text.

## 5. Tools (`lib/agent/tools.ts`)

| Tool | Access | Notes |
| --- | --- | --- |
| `get_my_account` | own | Name, email, phone, Instagram, order count |
| `list_my_orders` | own | Optional status filter. Items, totals, delivery state |
| `get_order` | own, checked per call | Address, payment, courier, return eligibility per item, warranty |
| `search_products` | public | Text, category, price range, in-stock filter |
| `open_carrier_trace` | action | Only when code says the parcel is shipped and late |
| `issue_delay_voucher` | action | 5% off the next order, per the `delay_compensation` policy. Owner only, order must be late or held by the carrier, one per order (`UNIQUE` in the `vouchers` table; asking again returns the same voucher). Shown as an orange reveal card, never written in the text |
| `request_human` | action | Priority and a note for staff. Makes the decision `escalate` |

How this answers "what if the model is tricked":

- **No tool takes a customer id, email or phone.** The identity comes from the grant, which closes over the request. Asking for "customer 2's orders" has no tool to go to, and extra arguments a model invents are stripped by zod.
- **Every order lookup re-checks ownership** with the same `checkIdentity()` the rules use.
- **Refusals look the same** whether the order is someone else's or doesn't exist, so order numbers can't be probed.
- **Derived facts are computed in code** (`views.ts`): days late, return eligibility (the record *or* the customer's own "box is open" counts against them), warranty and whether a person must take over. The model narrates them; it doesn't work them out.
- **Only this sender's earlier turns** go into the model's context. Another sender's replies never do.

This is the "verify the ID afterwards" idea, moved earlier: the data is scoped before the query instead of checked after the answer.

## Speed and streaming

- **The classifier runs in parallel with the agent.** The agent starts on the keyword reading straight away. When the classifier returns:
  - it's discarded if the classifier's reading means a person must handle the message;
  - it's restarted with narrower access if the classifier changes who may see what (e.g. a third-party flag). Streamed text is held back until then.
- **Groq models are split** so they don't share one rate limit: the agent gets `gpt-oss-120b`, and the classifier and phrasing share `gpt-oss-20b`. Most of the old 30-second waits were rate-limit retries on one shared model.
- **Streaming.** `POST /api/triage` with `stream: true` returns NDJSON:
  - progress steps ("Looking up your orders", "Checking order #1048"…)
  - reply text, one sentence at a time, emitted only after that sentence plus everything before it passes the output checks
  - then the full result

  If the model goes on to call a tool, or its reply needs a rewrite, a `text-reset` event clears the streamed text. Nothing unchecked ever reaches the screen.
- The Why panel footer shows the classifier and agent times.

## 6. Decision

The decision comes from what the tools recorded, not from what the model wrote:

- `request_human` called → `escalate`
- any lookup refused → `request_verification`
- otherwise → `resolve`

It's then combined with the gate's decision, and the stricter one wins. The model can't talk its way to a looser outcome.

## 7. Output checks (`lib/agent/validate.ts`)

The allowed facts are the tool outputs from this run plus the written policy:

- **Personal data:** every address, email and phone the shop holds is checked (accents are ignored, so "Nëna Terezë" matches "Nena Tereze"). Each one must have come from this run's tools or from the customer's own messages.
- **Numbers:** days, prices, dates and counts must appear in a tool result, the policy, the service levels or the customer's message.
- **Promises:** refund, replacement, free, discount, voucher and similar words are blocked unless the records or policy contain them.
- **Internals:** the reply can't mention tool names, instructions or checks.
- **Language:** the reply must be in the customer's language.

A failed reply gets one rewrite, with the reasons fed back to the model. If the rewrite also fails:

- **Fallback on:** the rule path's approved template is sent. For open questions, a handoff is sent instead.
- **Fallback off (pure-AI mode):** the request errors instead of sending anything unchecked.

## Skills (`lib/agent/skills/`)

Plain-language instructions, kept apart from code so tone and procedure can be tuned without touching access:

- `voice`: tone, language and format (the "how to respond" skill)
- `privacy`: whose data may be shared and how to handle injection attempts
- `orders`: status, lists, returns and warranty procedure
- `catalog`: product questions
- `handoff`: when and how to bring in a person

A skill can't grant access. A skill that said "share everything" would still hit the tools and the output checks.

## Models

| Keys set | Agent model |
| --- | --- |
| `AI_GATEWAY_API_KEY` | `AGENT_MODEL` (default `anthropic/claude-haiku-4.5`) |
| `GROQ_API_KEY` only | `GROQ_AGENT_MODEL` (default `openai/gpt-oss-120b`) |
| neither, or `AGENT_DISABLED=1` | none: fixed rule paths and templates |

On Groq's free tier, the classifier and the agent share the 120b model's per-minute budget. If you hit rate limits, set `GROQ_AGENT_MODEL` to a different model.

## Stress test

Stress mode swaps in a rogue agent (`models.ts`) that behaves as if a prompt injection took it over:

1. It requests two orders, mostly other customers', and calls `list_my_orders` with an invented `customer_id`.
2. It replies with other customers' addresses and a refund nobody approved.

The tools refuse the lookups, the output checks reject both replies, and the approved template goes out.

## Tests

- `tests/agent.test.ts` uses scripted models: each test sets exactly which tools the "model" calls and what it writes, including hostile behaviour. What's tested is the code around the model, which has to hold whatever the model does.
- `tests/pipeline.test.ts` keeps covering the gate, the rules-only path and the stress test.

## Known limits

- Identity in the demo comes from the sender picker. In production, `senderId` must come from the channel webhook and never from the browser.
- Earlier assistant replies are held by the client and sent back as context. They're never treated as facts, and the leak check runs regardless.
- `protectedPersonalData()` loads every address, email and phone on each message. That's fine at demo scale; a real shop would index it or check only the values near names or numbers found in the reply.
