import { createClient } from "@libsql/client";
import { Experimental_EvaluationMockModelV4 as MockEvaluationModel, MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureSeeded, setDatabase } from "@/lib/db/client";
import { contactLog, findOrder, recordTriage, resolveSender } from "@/lib/db/repo";
import { roguePhraser, validateReply } from "@/lib/engine/phrasing";
import { decisionProvider, fallbackEnabled, phrasingProvider } from "@/lib/engine/config";
import { proposeWithLanguageModel } from "@/lib/engine/groq";
import { jevProposer } from "@/lib/engine/jev";
import { depsForMode, runPipeline, type PipelineDeps } from "@/lib/engine/pipeline";
import { renderDraft } from "@/lib/engine/templates";
import type { Decision, Intent, ThreadMessage } from "@/lib/engine/types";
import { SCENARIOS } from "@/lib/scenarios";

/*
 * Every test runs against a fresh in-memory copy of db/schema.sql + db/seed.sql.
 * The seed is written for 2026-09-24, so "now" is pinned to that morning.
 */
const NOW = new Date("2026-09-24T10:00:00Z");
const RULES_ONLY: PipelineDeps = { now: NOW, proposer: null, phraser: null, allowFallback: true };

/** Seed senders (channel:handle). */
const DRITA = "viber:+38344100101"; // #1026, #1048 (late)
const ARBEN_IG = "instagram:@arben.hoxha"; // #1031
const ARBEN_VIBER = "viber:+38345100202";
const LEOTRIM = "email:leotrim.berisha@example.com"; // #1014 headphones (opened, 45 days), #1044 charger
const VALMIRA = "viber:+38343100404"; // two unanswered angry messages
const BROTHER = "viber:+38349100909"; // not a customer
const ARDIT = "instagram:@ardit.morina"; // no orders
const FATMIRE = "email:fatmire.shala@example.com"; // #1019, #1034 (cancelled), #1050 (processing)
const BESNIK = "viber:+38345100707"; // #1022 (delivered exactly 30 days ago), #1046
const LIRIJE_IG = "instagram:@lirije.bytyqi"; // #1009, #1037, #1049 (in transit, on time)
const GUEST = "instagram:@new.customer";

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  await ensureSeeded(client);
  setDatabase(client);
  return client;
}

beforeAll(async () => {
  await freshDb();
});

async function run(text: string, senderId: string, deps: PipelineDeps = RULES_ONLY, thread: ThreadMessage[] = []) {
  const sender = await resolveSender(senderId);
  if (!sender) throw new Error(`unknown sender ${senderId}`);
  return runPipeline({ text, sender, thread }, deps);
}

const ARBEN_ADDRESS = "Rr. Nena Tereze 12, Prishtine";
const ARBEN_EMAIL = "arben.hoxha@example.com";
const ARBEN_PHONE = "+38345100202";

type Answers = Awaited<ReturnType<MockEvaluationModel["doEvaluate"]>>["answers"];

function jevAnswers(intent: Intent, decision: Decision, flags: Partial<Record<string, number>> = {}, p = 0.93): Answers {
  const decisions: Decision[] = ["resolve", "request_verification", "escalate"];
  return {
    intent: { type: "choice", choice: intent },
    frustrated: { type: "boolean", probability: flags.frustrated ?? 0.02 },
    repeat_contact: { type: "boolean", probability: flags.repeat_contact ?? 0.02 },
    third_party: { type: "boolean", probability: flags.third_party ?? 0.02 },
    wants_personal_data: { type: "boolean", probability: flags.wants_personal_data ?? 0.02 },
    decision: { type: "choice", choice: decision, probabilities: Object.fromEntries(decisions.map((d) => [d, d === decision ? p : (1 - p) / 2])) },
  };
}
const withJev = (answers: Answers): PipelineDeps => ({
  now: NOW,
  proposer: jevProposer(new MockEvaluationModel({ doEvaluate: async () => ({ answers, warnings: [] }) }), "jev-mock"),
  phraser: null,
  allowFallback: true,
});

describe("the five challenge messages — rules only, facts from the seed DB", () => {
  it.each(SCENARIOS)("$title → $expected", async (s) => {
    expect((await run(s.text, s.senderId)).decision).toBe(s.expected);
  });

  it("1 · late order: 2 days past the shipment's expected date, Albanian, trace opened", async () => {
    const r = await run(SCENARIOS[0].text, DRITA);
    expect(r.why.firedRule.id).toBe("R6");
    expect(r.reply.language).toBe("sq");
    expect(r.reply.text).toContain("#1048");
    expect(r.reply.text).toContain("22 shtator");
    expect(r.reply.text).toContain("2 ditë me vonesë");
    expect(r.why.actions.map((a) => a.kind)).toContain("carrier_trace");
    expect(r.reply.text).not.toContain("Fehmi Agani");
  });

  it("2 · return: 45 days from the record and opened per order_items → declined", async () => {
    const r = await run(SCENARIOS[1].text, LEOTRIM);
    expect(r.outcome).toBe("Declined per policy");
    expect(r.reply.text).toMatch(/45 days ago/);
    expect(r.why.facts.find((f) => f.label === "Return eligible")?.value).toMatch(/15 days past the window and item opened/);
  });

  it("3 · angry repeat: contact log has 2 unanswered messages → R1", async () => {
    const r = await run(SCENARIOS[2].text, VALMIRA);
    expect(r.why.firedRule.id).toBe("R1");
    expect(r.why.handoff?.priority).toBe("urgent");
    expect(r.why.checks.find((c) => c.id === "R1")!.detail).toMatch(/2 unanswered/);
  });

  it("4 · third party: address withheld", async () => {
    const r = await run(SCENARIOS[3].text, BROTHER);
    expect(r.why.firedRule.id).toBe("R3");
    for (const pii of ["Nena Tereze", ARBEN_EMAIL, "100202"]) expect(r.reply.text).not.toContain(pii);
  });

  it("5 · installments: answered from the installments policy on file (db/extensions.sql)", async () => {
    const r = await run(SCENARIOS[4].text, ARDIT);
    expect(r.why.firedRule.id).toBe("R6");
    expect(r.reply.text).toContain("Raiffeisen Bank");
  });

  it("a topic with no policy row still goes to a person (R2)", async () => {
    const r = await run("A mund ta ndërroj telefonin e vjetër me të ri (trade-in)?", ARDIT);
    expect(r.why.firedRule.id).toBe("R2");
    expect(r.decision).toBe("escalate");
  });
});

describe("stress test — overconfident model + rogue phraser", () => {
  it.each(SCENARIOS)("$title still → $expected", async (s) => {
    const r = await run(s.text, s.senderId, { ...depsForMode("stress"), now: NOW });
    expect(r.decision).toBe(s.expected);
    expect(r.why.phrasing.engine).toBe("template");
  });
});

describe("Jev / Groq integration (mock models)", () => {
  it("agreeing Jev passes through", async () => {
    const r = await run(SCENARIOS[0].text, DRITA, withJev(jevAnswers("order_status", "resolve")));
    expect(r.why.guard.outcome).toBe("agreed");
  });
  it("Jev can add caution", async () => {
    const r = await run("Where is my order #1049? This is getting old.", LIRIJE_IG, withJev(jevAnswers("order_status", "resolve", { frustrated: 0.87 })));
    expect(r.decision).toBe("escalate");
  });
  it("unsure Jev → human", async () => {
    const r = await run(SCENARIOS[0].text, DRITA, withJev(jevAnswers("order_status", "resolve", {}, 0.4)));
    expect(r.why.guard.outcome).toBe("low_confidence");
  });
  it("Groq label outside the list → rules decide", async () => {
    const model = new MockLanguageModelV4({
      provider: "groq",
      modelId: "mock",
      doGenerate: async () => ({
        content: [{ type: "text", text: JSON.stringify({ intent: "x", decision: "approve" }) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
        warnings: [],
      }),
    });
    const r = await run("Can I do a trade-in of my old phone?", ARDIT, { now: NOW, proposer: (st) => proposeWithLanguageModel(model, st, "groq/mock", "Groq"), phraser: null, allowFallback: true });
    expect(r.why.guard.outcome).toBe("model_unavailable");
    expect(r.decision).toBe("escalate");
  });
});

describe("privacy and ownership", () => {
  const ask = "What's the address on order #1031?";
  it.each([ARBEN_IG, ARBEN_VIBER])("buyer (%s) gets the address", async (id) => {
    const r = await run(ask, id);
    expect(r.decision).toBe("resolve");
    expect(r.reply.text).toContain(ARBEN_ADDRESS);
  });
  it("guest stating email + phone is verified; one alone isn't", async () => {
    expect((await run(`${ask} My email is ${ARBEN_EMAIL} and phone ${ARBEN_PHONE}`, GUEST)).decision).toBe("resolve");
    expect((await run(`${ask} My email is ${ARBEN_EMAIL}`, GUEST)).decision).toBe("request_verification");
  });
  it.each([
    [DRITA, "What's the status of order #1049?"],
    [LEOTRIM, "I want to return order #1048"],
  ])("%s can't see someone else's order", async (id, text) => {
    const r = await run(text, id);
    expect(r.why.firedRule.id).toBe("R3");
  });
});

describe("paths computed from DB records and policies", () => {
  it.each([
    ["Where is my order #1050?", FATMIRE, "resolve", "R6"],
    ["Where is order #9999?", GUEST, "request_verification", "R4"],
    ["What are your opening hours?", GUEST, "escalate", "R2"],
    ["How long does delivery take?", GUEST, "resolve", "R6"],
    ["I'd like to return the laptop from order #1022", BESNIK, "resolve", "R6"],
    ["My charger doesn't work", DRITA, "escalate", "R5"],
    ["Where is my order?", LIRIJE_IG, "resolve", "R6"],
    ["Where is my order #1034?", FATMIRE, "escalate", "R5"],
    ["hello", DRITA, "resolve", "R6"],
    ["Do you have headphones under €100?", GUEST, "resolve", "R6"],
    ["Do you do gift wrapping?", GUEST, "escalate", "R2"],
  ] as const)("%s (%s) → %s via %s", async (text, sender, decision, rule) => {
    const r = await run(text, sender);
    expect(r.decision).toBe(decision);
    expect(r.why.firedRule.id).toBe(rule);
  });

  it("adding a policy row makes the agent answer it; the audit log is written", async () => {
    const client = await freshDb();
    await client.execute("INSERT INTO policies (topic, rule_text, value) VALUES ('trade_in', 'Trade-ins: bring your old phone to the store for a credit valued on the spot.', NULL)");
    const r = await run("Can I do a trade-in of my old phone?", ARDIT);
    expect(r.decision).toBe("resolve");
    expect(r.reply.text).toContain("valued on the spot");

    const sender = (await resolveSender(VALMIRA))!;
    const esc = await run(SCENARIOS[2].text, VALMIRA);
    const convId = await recordTriage({ sender, text: SCENARIOS[2].text, result: esc, now: NOW });
    const log = await client.execute({ sql: "SELECT action FROM agent_log WHERE conv_id = ?", args: [convId] });
    expect(log.rows[0].action).toBe("escalate");
    const tickets = await client.execute({ sql: "SELECT priority FROM escalations WHERE conv_id = ?", args: [convId] });
    expect(tickets.rows[0].priority).toBe("high");
    const later = new Date(NOW.getTime() + 60_000);
    expect((await contactLog(sender, later, new Date("2026-09-24T00:00:00Z"))).at(-1)?.answered).toBe(true);
    expect(await findOrder("1048")).toBeDefined();
    await freshDb();
  });
});

describe("reply validator", () => {
  it("rejects an invented promise", async () => {
    const r = await run(SCENARIOS[0].text, DRITA);
    const b = { ...r.why, kind: "order_late" as const };
    void b;
    const brief = { kind: "order_late" as const, decision: "resolve" as const, outcome: "", params: { orderId: "1048", daysLate: 2, expectedBy: "2026-09-22", lastUpdate: "2026-09-21", windowMin: 2, windowMax: 4, carrier: "Posta e Kosoves", traceId: "TRC-1048" }, disclose: [], withhold: ["Rr. Fehmi Agani 8, Prishtine"] };
    const draft = renderDraft(brief, "sq");
    expect(validateReply(draft + " Si kompensim ju japim një kupon.", brief, draft, "sq").map((i) => i.check)).toContain("new_commitment");
    expect(roguePhraser.name).toBeTruthy();
    expect(r.reply.text).toContain("TRC-1048");
  });
});

describe("engine selection", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it("uses Jev when a gateway key exists, else Groq, else rules", () => {
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.USE_AI_GATEWAY;
    delete process.env.GROQ_API_KEY;
    expect(decisionProvider()).toBe("rules");
    process.env.GROQ_API_KEY = "test";
    expect(decisionProvider()).toBe("groq");
    expect(phrasingProvider()).toBe("groq");
    process.env.AI_GATEWAY_API_KEY = "test";
    expect(decisionProvider()).toBe("jev");
  });

  it("disables template fallback by default, requiring AI phrasing", () => {
    delete process.env.ALLOW_TEMPLATE_FALLBACK;
    expect(fallbackEnabled()).toBe(false);
    expect(fallbackEnabled("1")).toBe(true);
    expect(fallbackEnabled("0")).toBe(false);
    process.env.ALLOW_TEMPLATE_FALLBACK = "1";
    expect(fallbackEnabled()).toBe(true);
  });

  it("fails triage with missing AI error when fallback is disabled and no phraser is provided", async () => {
    await expect(run("Where is order #1048?", DRITA, { now: NOW, proposer: null, phraser: null, allowFallback: false })).rejects.toThrow(
      "AI phrasing model is required",
    );
  });
});

describe("order listing and order cards", () => {
  it("shows all orders for verified customer asking how many orders they have", async () => {
    const r = await run("can you check how many orders i have?", LEOTRIM);
    expect(r.decision).toBe("resolve");
    expect(r.why.firedRule.id).toBe("R6");
    expect(r.reply.text).toContain("3 orders on file");
    expect(r.reply.text).toContain("#1044");
    expect(r.reply.text).toContain("#1014");
    expect(r.orders).toBeDefined();
    expect(r.orders?.length).toBe(3);
    expect(r.orders?.map((o) => o.id)).toEqual(expect.arrayContaining(["1054", "1044", "1014"]));
  });

  it("handles Albanian inquiry for customer order count", async () => {
    const r = await run("Sa porosi kam të regjistruara?", LEOTRIM);
    expect(r.decision).toBe("resolve");
    expect(r.reply.language).toBe("sq");
    expect(r.reply.text).toContain("3 porosi të regjistruara");
    expect(r.orders?.length).toBe(3);
  });

  it("confirms 0 orders for verified customer with no orders", async () => {
    const r = await run("how many orders do I have?", ARDIT);
    expect(r.decision).toBe("resolve");
    expect(r.reply.text).toMatch(/no orders on file/i);
    expect(r.orders).toEqual([]);
  });

  it("blocks third party asking for order list", async () => {
    const r = await run("I am Arben's brother, what orders does he have?", BROTHER);
    expect(r.decision).toBe("request_verification");
    expect(r.why.firedRule.id).toBe("R3");
    expect(r.orders).toBeUndefined();
  });

  it("attaches single order card when verified customer checks single order status", async () => {
    const r = await run("Porosia #1048 ende s'ka ardhur. Kanë kaluar 6 ditë.", DRITA);
    expect(r.decision).toBe("resolve");
    expect(r.orders?.length).toBe(1);
    expect(r.orders?.[0].id).toBe("1048");
  });
});
