import { createClient, type Client } from "@libsql/client";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import { grantAccess } from "@/lib/agent/access";
import { ToolLedger } from "@/lib/agent/ledger";
import { contentToStream, type AgentModel } from "@/lib/agent/models";
import { createSupportTools } from "@/lib/agent/tools";
import { delayReward } from "@/lib/agent/views";
import { ensureSeeded, setDatabase } from "@/lib/db/client";
import { findOrder, getPolicyBook, resolveSender } from "@/lib/db/repo";
import { runPipeline, type PipelineDeps } from "@/lib/engine/pipeline";
import { extractSignals } from "@/lib/engine/signals";
import type { ThreadMessage } from "@/lib/engine/types";

const NOW = new Date("2026-09-24T10:00:00Z");
const TODAY = new Date("2026-09-24T00:00:00Z");

const BESNIK = "viber:+38345100707";
const DRITA = "viber:+38344100101";
const FATMIRE = "email:fatmire.shala@example.com";
const GUEST = "instagram:@new.customer";

const BESNIK_ADDRESS = "Rr. Agim Ramadani 45, Prishtine";
const NEW_ADDRESS = "Rr. Bill Clinton 5, Prishtine";

let client: Client;

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  await ensureSeeded(client);
  setDatabase(client);
});

type Call = [tool: string, input: Record<string, unknown>];
type Step = { calls: Call[] } | { text: string } | { fail: string };

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function scripted(steps: Step[]) {
  let i = 0;
  const outputs: string[] = [];
  const generate = async (options: Parameters<MockLanguageModelV4["doGenerate"]>[0]) => {
    outputs.push(JSON.stringify(options.prompt.filter((m) => m.role === "tool")));
    const step = steps[Math.min(i++, steps.length - 1)];
    if ("fail" in step) throw new Error(step.fail);
    if ("calls" in step) {
      return {
        content: step.calls.map(([toolName, input], n) => ({ type: "tool-call" as const, toolCallId: `c${i}-${n}`, toolName, input: JSON.stringify(input) })),
        finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
        usage,
        warnings: [],
      };
    }
    return { content: [{ type: "text" as const, text: step.text }], finishReason: { unified: "stop" as const, raw: "stop" }, usage, warnings: [] };
  };
  const model = new MockLanguageModelV4({
    provider: "mock",
    modelId: "scripted",
    doGenerate: generate,
    doStream: async (options) => contentToStream(await generate(options)),
  });
  const agent: AgentModel = { name: "scripted-agent", model, simulated: true };
  return { agent, calls: () => i, toolResults: () => outputs.at(-1) ?? "" };
}

const deps = (agent: AgentModel | null, allowFallback = false): PipelineDeps => ({ now: NOW, proposer: null, phraser: null, agent, allowFallback });

const toolCalls = (r: { agent?: { toolCalls: { tool: string; access: string }[] } }) =>
  (r.agent?.toolCalls ?? []).filter((t) => t.tool !== "preload").map((t) => `${t.tool}:${t.access}`);

async function run(text: string, senderId: string, d: PipelineDeps, thread: ThreadMessage[] = []) {
  const sender = await resolveSender(senderId);
  if (!sender) throw new Error(`unknown sender ${senderId}`);
  return runPipeline({ text, sender, thread }, d);
}

async function auditRows(orderId: number) {
  return (await client.execute({ sql: "SELECT kind, before_value, after_value, requested_via FROM order_changes WHERE order_id = ?", args: [orderId] })).rows;
}

async function stock(productId: number) {
  return Number((await client.execute({ sql: "SELECT stock FROM products WHERE product_id = ?", args: [productId] })).rows[0].stock);
}

describe("the gate sends order changes to the agent", () => {
  it("reads address changes, removals and cancellations as order changes, not personal-data requests", () => {
    for (const text of [
      "Can I change the delivery address on order #1050?",
      "Dua ta ndryshoj adresën e porosisë 1050",
      "Please remove the charger from my order",
      "Hiqni karikuesin nga porosia ime",
      "Pershendetje, dua ta anuloj porosine 1050",
    ]) {
      const s = extractSignals(text);
      expect(s.intent.value, text).toBe("order_change");
      expect(s.personalData.hit, text).toBe(false);
    }
    expect(extractSignals("What is the address on order #1031?").intent.value).toBe("personal_data_request");
    expect(extractSignals("Any update on my order?").intent.value).toBe("order_status");
  });

  it("a Prishtina address is not a broken product", () => {
    expect(extractSignals("Rr. Bill Clinton 5, Prishtine").intent.value).not.toBe("product_fault");
    expect(extractSignals("Jetoj në Prishtinë").intent.value).not.toBe("product_fault");
    expect(extractSignals("Laptopi është prishur").intent.value).toBe("product_fault");
  });

  it("lets the agent handle it instead of handing it off", async () => {
    const m = scripted([{ text: "Sure — what's the new address?" }]);
    const r = await run("Can I change the delivery address on my order #1051?", BESNIK, deps(m.agent));
    expect(r.intent).toBe("order_change");
    expect(r.decision).toBe("resolve");
    expect(m.calls()).toBeGreaterThan(0);
  });

  it("goes to staff when no agent is configured", async () => {
    const r = await run("Can I change the delivery address on my order #1051?", BESNIK, deps(null, true));
    expect(r.decision).toBe("escalate");
  });
});

describe("the agent changes orders that haven't shipped", () => {
  it("changes the delivery address to the one the customer wrote, and logs it", async () => {
    const m = scripted([
      { calls: [["change_delivery_address", { order_id: "1051", new_address: NEW_ADDRESS }]] },
      { text: `Done! Order #1051 will now be delivered to ${NEW_ADDRESS}.` },
    ]);
    const r = await run(`Please change the address on order 1051 to ${NEW_ADDRESS}`, BESNIK, deps(m.agent));
    expect(toolCalls(r)).toEqual(["change_delivery_address:action"]);
    expect(r.decision).toBe("resolve");
    expect(r.why.actions.map((a) => a.kind)).toContain("order_change");
    expect((await findOrder("1051"))?.buyer.address).toBe(NEW_ADDRESS);
    expect(await auditRows(1051)).toEqual([
      expect.objectContaining({ kind: "address", before_value: BESNIK_ADDRESS, after_value: NEW_ADDRESS, requested_via: "viber:+38345100707" }),
    ]);
  });

  it("takes the new address from a later message in the same conversation", async () => {
    const m = scripted([{ calls: [["change_delivery_address", { order_id: "1051", new_address: NEW_ADDRESS }]] }, { text: `Done, #1051 goes to ${NEW_ADDRESS}.` }]);
    const thread: ThreadMessage[] = [{ senderId: BESNIK, text: "I need to change the address on order 1051", reply: "Of course, what's the new address?" }];
    const r = await run(`The new one is ${NEW_ADDRESS}`, BESNIK, deps(m.agent), thread);
    expect(toolCalls(r)).toEqual(["change_delivery_address:action"]);
    expect((await findOrder("1051"))?.buyer.address).toBe(NEW_ADDRESS);
  });

  it("removes an item the customer named, puts it back in stock and gives the new total", async () => {
    const before = await stock(4);
    const m = scripted([
      { calls: [["remove_order_item", { order_id: "1051", item: "Sony WH-CH720N" }]] },
      { text: "Done — I removed the Sony WH-CH720N from order #1051. It now has 2 Anker 65W USB-C GaN Charger, €79.80 in total, paid on delivery." },
    ]);
    const r = await run("Please remove the headphones from my order 1051", BESNIK, deps(m.agent));
    expect(toolCalls(r)).toEqual(["remove_order_item:action"]);
    expect(m.toolResults()).toContain('"new_total_eur":79.8');
    const order = await findOrder("1051");
    expect(order?.items.map((i) => [i.name, i.qty])).toEqual([["Anker 65W USB-C GaN Charger", 2]]);
    expect(await stock(4)).toBe(before + 1);
    expect((await auditRows(1051))[0]).toMatchObject({ kind: "remove_item" });
  });

  it("lowers a quantity", async () => {
    const m = scripted([
      { calls: [["remove_order_item", { order_id: "1051", item: "Anker 65W USB-C GaN Charger", quantity: 1 }]] },
      { text: "Done, order #1051 now has 1 Anker 65W USB-C GaN Charger." },
    ]);
    await run("I only want one charger instead of two on order 1051", BESNIK, deps(m.agent));
    expect((await findOrder("1051"))?.items.find((i) => i.productId === "9")?.qty).toBe(1);
  });

  it("cancels a cash-on-delivery order, restocks it, and won't cancel it twice", async () => {
    const [sony, anker] = [await stock(4), await stock(9)];
    const m = scripted([{ calls: [["cancel_order", { order_id: "1051" }]] }, { text: "Order #1051 is cancelled. Nothing has been paid for it." }]);
    const r = await run("Please cancel my order 1051", BESNIK, deps(m.agent));
    expect(toolCalls(r)).toEqual(["cancel_order:action"]);
    expect((await findOrder("1051"))?.status).toBe("cancelled");
    expect([await stock(4), await stock(9)]).toEqual([sony + 1, anker + 2]);

    const again = scripted([{ calls: [["cancel_order", { order_id: "1051" }]] }, { text: "Order #1051 is cancelled." }]);
    const r2 = await run("Cancel order 1051", BESNIK, deps(again.agent));
    expect(toolCalls(r2)).toEqual(["cancel_order:action"]);
    expect([await stock(4), await stock(9)]).toEqual([sony + 1, anker + 2]);
  });
});

describe("staff take over what the agent may not do", () => {
  it("a shipped order goes to staff", async () => {
    const m = scripted([
      { calls: [["change_delivery_address", { order_id: "1048", new_address: NEW_ADDRESS }]] },
      { calls: [["request_human", { reason: "Wants #1048 (shipped) redirected to Rr. Bill Clinton 5.", priority: "normal" }]] },
      { text: "Order #1048 has already shipped, so a colleague will arrange the new address with the courier. They'll reply within 24 hours." },
    ]);
    const r = await run(`Can you change the address on my order #1048 to ${NEW_ADDRESS}?`, DRITA, deps(m.agent));
    expect(toolCalls(r)).toEqual(["change_delivery_address:refused", "request_human:action"]);
    expect(r.decision).toBe("escalate");
    expect((await findOrder("1048"))?.buyer.address).toBe("Rr. Fehmi Agani 8, Prishtine");
  });

  it("a prepaid order can change address, but cancelling it goes to staff", async () => {
    const cancel = scripted([{ calls: [["cancel_order", { order_id: "1050" }]] }, { text: "A colleague will handle the cancellation." }]);
    const r = await run("Please cancel order 1050", FATMIRE, deps(cancel.agent));
    expect(toolCalls(r)).toEqual(["cancel_order:refused"]);
    expect(cancel.toolResults()).toContain("staff_handoff_required");
    expect((await findOrder("1050"))?.status).toBe("processing");

    const move = scripted([{ calls: [["change_delivery_address", { order_id: "1050", new_address: NEW_ADDRESS }]] }, { text: `Done, #1050 goes to ${NEW_ADDRESS}.` }]);
    const r2 = await run(`Change the address on 1050 to ${NEW_ADDRESS}`, FATMIRE, deps(move.agent));
    expect(toolCalls(r2)).toEqual(["change_delivery_address:action"]);
  });

  it("after the allowed number of address changes, staff confirm the address", async () => {
    const policies = await getPolicyBook();
    const sender = (await resolveSender(BESNIK))!;
    const texts = ["Change the address on 1051 to Rr. A 1, Prishtine, then Rr. B 2, Prishtine, then Rr. C 3, Prishtine, then Rr. D 4, Prishtine"];
    const change = (address: string) => {
      const tools = createSupportTools(grantAccess({ sender, signals: extractSignals(texts[0]), now: NOW, today: TODAY, policies }), new ToolLedger(), texts);
      return tools.change_delivery_address.execute!({ order_id: "1051", new_address: address }, { toolCallId: "t", messages: [], context: {} } as never) as Promise<Record<string, unknown>>;
    };
    for (const a of ["Rr. A 1, Prishtine", "Rr. B 2, Prishtine", "Rr. C 3, Prishtine"]) expect((await change(a)).changed).toBe(true);
    const fourth = await change("Rr. D 4, Prishtine");
    expect(fourth.changed).toBe(false);
    expect(fourth.staff_handoff_required).toBeDefined();
  });
});

describe("a change that was made is always confirmed", () => {
  it("if the model fails after changing the order, code confirms exactly what changed", async () => {
    const m = scripted([{ calls: [["remove_order_item", { order_id: "1051", item: "Sony WH-CH720N" }]] }, { fail: "429 rate limit" }]);
    const r = await run("Please remove the headphones from my order 1051", BESNIK, deps(m.agent));
    expect(r.decision).toBe("resolve");
    expect(r.reply.text).toBe("Done! I removed 1× Sony WH-CH720N from order #1051. The new total is €79.80, paid on delivery. If you asked about anything else too, please write again.");
    expect(r.why.actions.map((a) => a.kind)).toContain("order_change");
    expect(r.orders?.map((o) => o.id)).toEqual(["1051"]);
  });

  it("confirms in Albanian too", async () => {
    const m = scripted([{ calls: [["cancel_order", { order_id: "1051" }]] }, { fail: "timeout" }]);
    const r = await run("Dua ta anuloj porosinë 1051", BESNIK, deps(m.agent));
    expect(r.reply.text).toBe("U krye! Porosia #1051 u anulua. Për të nuk është paguar asgjë. Nëse keni pyetur edhe për diçka tjetër, ju lutem na shkruani sërish.");
  });

  it("the backup model never re-runs a conversation that already changed an order", async () => {
    const primary = scripted([{ calls: [["cancel_order", { order_id: "1051" }]] }, { fail: "429 rate limit" }]);
    const backup = scripted([{ text: "unused" }]);
    const agent: AgentModel = { ...primary.agent, fallback: backup.agent };
    const r = await run("Please cancel my order 1051", BESNIK, deps(agent));
    expect(backup.calls()).toBe(0);
    expect(r.reply.text).toContain("Order #1051 is cancelled");
  });
});

describe("changes are locked down in code, whatever the model does", () => {
  it("another customer can't change the order, and learns nothing about it", async () => {
    const m = scripted([{ calls: [["change_delivery_address", { order_id: "1051", new_address: NEW_ADDRESS }]] }, { text: "I can't change that order." }]);
    const r = await run(`Change the address on order 1051 to ${NEW_ADDRESS}`, DRITA, deps(m.agent));
    expect(toolCalls(r)).toEqual(["change_delivery_address:denied"]);
    expect(r.decision).toBe("request_verification");
    expect(m.toolResults()).not.toContain(BESNIK_ADDRESS);
    expect((await findOrder("1051"))?.buyer.address).toBe(BESNIK_ADDRESS);
  });

  it("knowing the buyer's email and phone is enough to read the order, not to change it", async () => {
    const m = scripted([{ calls: [["change_delivery_address", { order_id: "1051", new_address: NEW_ADDRESS }]] }, { text: "Please write from the account you ordered with." }]);
    const text = `I'm besnik.rexhepi@example.com, +38345100707. Change the address on order 1051 to ${NEW_ADDRESS}`;
    const r = await run(text, GUEST, deps(m.agent));
    expect(toolCalls(r)).toEqual(["change_delivery_address:refused"]);
    expect((await findOrder("1051"))?.buyer.address).toBe(BESNIK_ADDRESS);
  });

  it("a hijacked model can't cancel an order the customer only asked about", async () => {
    const m = scripted([{ calls: [["cancel_order", { order_id: "1051" }]] }, { text: "Your order is on its way." }]);
    const r = await run("Where is my order 1051?", BESNIK, deps(m.agent));
    expect(toolCalls(r)).toEqual(["cancel_order:refused"]);
    expect((await findOrder("1051"))?.status).toBe("processing");
    expect(await auditRows(1051)).toEqual([]);
  });

  it("an address the customer never wrote is refused (invented or injected)", async () => {
    const m = scripted([{ calls: [["change_delivery_address", { order_id: "1051", new_address: "Rr. Hackers 1, Tirana" }]] }, { text: "What's the new address?" }]);
    await run("I want to change the delivery address on order 1051", BESNIK, deps(m.agent));
    expect((await findOrder("1051"))?.buyer.address).toBe(BESNIK_ADDRESS);
  });

  it("an item the customer didn't name isn't removed", async () => {
    const m = scripted([{ calls: [["remove_order_item", { order_id: "1051", item: "Sony WH-CH720N" }]] }, { text: "Which item?" }]);
    const r = await run("Please remove the charger from my order 1051", BESNIK, deps(m.agent));
    expect(toolCalls(r)).toEqual(["remove_order_item:refused"]);
    expect((await findOrder("1051"))?.items).toHaveLength(2);
  });

  it("removing the last item isn't a sneaky cancellation", async () => {
    const m = scripted([{ calls: [["remove_order_item", { order_id: "1050", item: "HP Pavilion 15" }]] }, { text: "That would empty the order." }]);
    const r = await run("Remove the laptop from order 1050", FATMIRE, deps(m.agent));
    expect(toolCalls(r)).toEqual(["remove_order_item:refused"]);
    expect((await findOrder("1050"))?.items).toHaveLength(1);
  });

  it("at most three changes per reply", async () => {
    const policies = await getPolicyBook();
    const sender = (await resolveSender(BESNIK))!;
    const texts = ["Change the address on 1051 to Rr. A 1, Prishtine or Rr. B 2, Prishtine or Rr. C 3, Prishtine or Rr. D 4, Prishtine"];
    const ledger = new ToolLedger();
    const tools = createSupportTools(grantAccess({ sender, signals: extractSignals(texts[0]), now: NOW, today: TODAY, policies }), ledger, texts);
    for (const a of ["Rr. A 1, Prishtine", "Rr. B 2, Prishtine", "Rr. C 3, Prishtine", "Rr. D 4, Prishtine"]) {
      await tools.change_delivery_address.execute!({ order_id: "1051", new_address: a }, { toolCallId: "t", messages: [], context: {} } as never);
    }
    expect(ledger.traces.map((t) => t.access)).toEqual(["action", "action", "action", "refused"]);
    expect(ledger.traces[3].summary).toContain("one reply");
  });

  it("without a written policy on order changes, nothing can be changed", async () => {
    await client.execute("DELETE FROM policies WHERE topic = 'order_changes'");
    const m = scripted([{ calls: [["change_delivery_address", { order_id: "1051", new_address: NEW_ADDRESS }]] }, { text: "unused" }]);
    const r = await run(`Change the address on order 1051 to ${NEW_ADDRESS}`, BESNIK, deps(m.agent, true));
    expect(r.decision).toBe("escalate");
    expect((await findOrder("1051"))?.buyer.address).toBe(BESNIK_ADDRESS);
  });
});

describe("delay rewards grow with the delay and the order size, capped by policy", () => {
  it("picks 5% off, free shipping or a €5 gift card", async () => {
    const policies = await getPolicyBook();
    const order = (await findOrder("1048"))!;
    const big = { ...order, items: [{ ...order.items[0], price: 600, qty: 1 }] };
    expect(delayReward(order, 2, policies)).toEqual({ kind: "percent", percent: 5 });
    expect(delayReward(order, 3, policies)).toEqual({ kind: "free_shipping" });
    expect(delayReward(order, 9, policies)).toEqual({ kind: "free_shipping" });
    expect(delayReward(big, 5, policies)).toEqual({ kind: "gift_card", amountEur: 5 });
  });

  it("a policy row can't raise the gift card above €10", async () => {
    await client.execute(`UPDATE policies SET value = '{"percent":5,"valid_days":30,"tiers":[{"reward":"gift_card","amount_eur":500,"min_days_late":1,"min_order_eur":0}]}' WHERE topic = 'delay_compensation'`);
    const order = (await findOrder("1048"))!;
    expect(delayReward(order, 9, await getPolicyBook())).toEqual({ kind: "percent", percent: 5 });
  });
});

describe("an already-compensated delay", () => {
  it("the agent knows about the earlier voucher and shows the same one again", async () => {
    const first = scripted([{ calls: [["issue_delay_voucher", { order_id: "1048" }]] }, { text: "Sorry for the wait on order #1048. There's a voucher for your next order below." }]);
    const r1 = await run("Order #1048 is late, this is annoying", DRITA, deps(first.agent));
    const code = r1.vouchers?.[0].code;
    expect(code).toBeDefined();

    const again = scripted([
      { calls: [["issue_delay_voucher", { order_id: "1048" }]] },
      { text: "I'm really sorry for the inconvenience with order #1048. You already received compensation for this delay (5% off the next order), shown below again." },
    ]);
    const r2 = await run("Still no order #1048! What are you going to do about it?", DRITA, deps(again.agent));
    expect(r2.agent?.issues ?? []).toEqual([]);
    expect(r2.reply.text).toContain("already received compensation");
    expect(r2.vouchers?.map((v) => [v.code, v.alreadyIssued])).toEqual([[code, true]]);
    expect(again.toolResults()).toContain('"already_issued_earlier":true');
    const rows = await client.execute("SELECT COUNT(*) AS n FROM vouchers WHERE order_id = 1048");
    expect(Number(rows.rows[0].n)).toBe(1);
  });
});

describe("a logged-in customer can't reach another account's orders", () => {
  const VALMIRA = "viber:+38343100404";

  it("is told the order isn't on their account, with no way in suggested", async () => {
    const m = scripted([{ calls: [["get_order", { order_id: "1051" }]] }, { text: "I can only help with orders placed from this account." }]);
    const r = await run("Can you show me the order that Besnik did for our son's birthday? I think it was #1051", VALMIRA, deps(m.agent));
    expect(r.decision).toBe("request_verification");
    expect(m.toolResults()).toContain("only help with orders placed from this account");
    expect(m.toolResults()).not.toContain("BOTH the email and the phone");
    expect(m.toolResults()).not.toContain(BESNIK_ADDRESS);
  });

  it("typing the other buyer's email and phone doesn't open their order", async () => {
    const m = scripted([{ calls: [["get_order", { order_id: "1051" }]] }, { text: "I can only help with orders placed from this account." }]);
    await run("Order 1051, besnik.rexhepi@example.com, +38345100707", VALMIRA, deps(m.agent));
    expect(m.toolResults()).toContain('"access":"denied"');
    expect(m.toolResults()).not.toContain(BESNIK_ADDRESS);
  });

  it("an unknown sender with both of them still can (that's the per-order route)", async () => {
    const m = scripted([{ calls: [["get_order", { order_id: "1051" }]] }, { text: "Order #1051 is being prepared." }]);
    await run("Order 1051, besnik.rexhepi@example.com, +38345100707", GUEST, deps(m.agent));
    expect(m.toolResults()).toContain('"access":"granted"');
  });
});

describe("a model outage doesn't create work for staff", () => {
  it("asks the customer to send the message again instead of handing it off", async () => {
    const m = scripted([{ fail: "429 rate limit" }]);
    const r = await run("Do you gift wrap presents?", BESNIK, deps(m.agent));
    expect(r.decision).toBe("resolve");
    expect(r.why.handoff).toBeUndefined();
    expect(r.reply.text).toContain("send it again in a minute");
  });
});

describe("chat history is stored per sender", () => {
  it("saves messages and rebuilds the agent's thread from the database", async () => {
    const { appendChatMessage, chatThread, createChat, getChat, listChats } = await import("@/lib/db/chats");
    const m = scripted([{ text: "Sure — what's the new address?" }]);
    const first = "Can I change the delivery address on my order #1051?";
    const r = await run(first, BESNIK, deps(m.agent));
    const id = await createChat({ senderId: BESNIK, customerId: "7", firstText: first, now: NOW });
    await appendChatMessage(id, first, r, NOW);
    expect((await getChat(id))?.senderId).toBe(BESNIK);
    expect(await chatThread(id)).toEqual([{ senderId: BESNIK, text: first, decision: r.decision, reply: r.reply.text }]);
    expect((await listChats("7")).map((c) => c.id)).toEqual([id]);
    expect(await listChats("1")).toEqual([]);
  });
});

describe("a voucher that was issued is always shown", () => {
  it("if the model fails after issuing it, code confirms it and the card still shows", async () => {
    const m = scripted([{ calls: [["open_carrier_trace", { order_id: "1048" }], ["issue_delay_voucher", { order_id: "1048" }]] }, { fail: "stopped" }]);
    const r = await run("Kjo është e papranueshme, dua kompensim për porosinë 1048", DRITA, deps(m.agent));
    expect(r.vouchers).toHaveLength(1);
    expect(r.reply.text).toBe("Na vjen keq për vonesën. I kërkova korrierit ta gjurmojë porosinë (referenca TRC-1048). Për pritjen, më poshtë keni një kupon për porosinë e ardhshme. Nëse keni pyetur edhe për diçka tjetër, ju lutem na shkruani sërish.");
  });
});

describe("leaked model markup never reaches the customer", () => {
  it("a raw tool-call tag as the reply is rejected; the issued voucher is confirmed by code", async () => {
    const m = scripted([{ calls: [["issue_delay_voucher", { order_id: "1048" }]] }, { text: "</tool_call>" }]);
    const r = await run("Porosia 1048 është vonë, dua kompensim", DRITA, deps(m.agent));
    expect(r.reply.text).not.toContain("tool_call");
    expect(r.vouchers).toHaveLength(1);
  });
});

describe("the reply can't claim actions that weren't taken", () => {
  it("saying a courier trace was opened without opening one is rejected", async () => {
    const m = scripted([{ text: "Po hap një gjurmim te kurieri për porosinë #1048." }, { text: "Porosia #1048 është në rrugë me Posta e Kosovës." }]);
    const r = await run("Ku është porosia 1048?", DRITA, deps(m.agent));
    expect(r.agent?.issues.map((i) => i.detail)).toContain("Says a courier trace was opened, but none was");
    expect(r.reply.text).not.toContain("gjurmim");
  });
});
