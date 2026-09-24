import { Experimental_EvaluationMockModelV4 as MockEvaluationModel, MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";
import { findSender } from "@/lib/data/customers";
import { findOrder } from "@/lib/data/orders";
import { roguePhraser, validateReply, type Phraser } from "@/lib/engine/phrasing";
import { decisionProvider, phrasingProvider } from "@/lib/engine/config";
import { proposeWithLanguageModel } from "@/lib/engine/groq";
import { jevProposer } from "@/lib/engine/jev";
import { depsForMode, runPipeline, type PipelineDeps } from "@/lib/engine/pipeline";
import { renderDraft } from "@/lib/engine/templates";
import type { Decision, Intent, ThreadMessage } from "@/lib/engine/types";
import { SCENARIOS } from "@/lib/scenarios";

const NOW = new Date("2026-09-24T10:00:00Z");
const RULES_ONLY: PipelineDeps = { now: NOW, proposer: null, phraser: null };
const arben = findOrder("1031", NOW)!;

function run(text: string, senderId: string, deps: PipelineDeps = RULES_ONLY, thread: ThreadMessage[] = []) {
  return runPipeline({ text, sender: findSender(senderId)!, thread }, deps);
}

type Answers = Awaited<ReturnType<MockEvaluationModel["doEvaluate"]>>["answers"];

function jevAnswers(intent: Intent, decision: Decision, flags: Partial<Record<string, number>> = {}, p = 0.93): Answers {
  const decisions: Decision[] = ["resolve", "request_verification", "escalate"];
  return {
    intent: { type: "choice", choice: intent },
    frustrated: { type: "boolean", probability: flags.frustrated ?? 0.02 },
    repeat_contact: { type: "boolean", probability: flags.repeat_contact ?? 0.02 },
    third_party: { type: "boolean", probability: flags.third_party ?? 0.02 },
    wants_personal_data: { type: "boolean", probability: flags.wants_personal_data ?? 0.02 },
    decision: {
      type: "choice",
      choice: decision,
      probabilities: Object.fromEntries(decisions.map((d) => [d, d === decision ? p : (1 - p) / 2])),
    },
  };
}

function mockJev(answers: Answers) {
  return new MockEvaluationModel({ doEvaluate: async () => ({ answers, warnings: [] }) });
}

const withJev = (answers: Answers): PipelineDeps => ({ now: NOW, proposer: jevProposer(mockJev(answers), "jev-mock"), phraser: null });

describe("the five challenge messages — rules only", () => {
  it.each(SCENARIOS)("$title → $expected", async (s) => {
    const r = await run(s.text, s.senderId);
    expect(r.decision).toBe(s.expected);
  });

  it("1 · late order: facts computed from the record, answered in Albanian, trace opened", async () => {
    const r = await run(SCENARIOS[0].text, "blerta");
    expect(r.why.firedRule.id).toBe("R6");
    expect(r.reply.language).toBe("sq");
    expect(r.reply.text).toContain("#1048");
    expect(r.reply.text).toContain("para 6 ditësh");
    expect(r.reply.text).toContain("2 ditë përtej");
    expect(r.why.actions.map((a) => a.kind)).toContain("carrier_trace");
    expect(r.reply.text).not.toContain("Luan Haradinaj");
  });

  it("2 · return: both conditions fail, answered in English with a clear no", async () => {
    const r = await run(SCENARIOS[1].text, "leon");
    expect(r.outcome).toBe("Declined per policy");
    expect(r.reply.language).toBe("en");
    expect(r.reply.text).toMatch(/can't be returned/);
    expect(r.reply.text).toMatch(/45 days ago/);
    expect(r.why.facts.find((f) => f.label === "Return eligible")?.value).toMatch(/15 days past the window and box opened/);
  });

  it("3 · angry repeat: R1 escalates, reply is only a handoff notice", async () => {
    const r = await run(SCENARIOS[2].text, "gentrit");
    expect(r.why.firedRule.id).toBe("R1");
    expect(r.why.handoff?.priority).toBe("urgent");
    expect(r.reply.text).not.toMatch(/warranty|repair|diagnos/i);
    const r1 = r.why.checks.find((c) => c.id === "R1")!;
    expect(r1.detail).toMatch(/3rd time/);
    expect(r1.detail).toMatch(/NOBODY/);
    expect(r1.detail).toMatch(/2 unanswered/);
  });

  it("4 · third party: address withheld, verification requested", async () => {
    const r = await run(SCENARIOS[3].text, "dren");
    expect(r.why.firedRule.id).toBe("R3");
    for (const pii of [arben.buyer.address.split(",")[0], arben.buyer.email, "731"]) {
      expect(r.reply.text).not.toContain(pii);
    }
    expect(r.reply.text).not.toContain("Arben");
    expect(r.why.withheld.join(" ")).toMatch(/delivery address on order #1031/);
  });

  it("5 · installments: no policy → escalated, reply in Albanian doesn't guess", async () => {
    const r = await run(SCENARIOS[4].text, "albina");
    expect(r.why.firedRule.id).toBe("R2");
    expect(r.reply.language).toBe("sq");
    expect(r.reply.text).toContain("blerjen me këste");
    expect(r.reply.text).not.toMatch(/\bpo\b|mund ta blini/i);
  });
});

describe("stress test — overconfident decision model + rogue phraser", () => {
  const stress: PipelineDeps = { ...depsForMode("stress"), now: NOW };

  it.each(SCENARIOS)("$title still → $expected", async (s) => {
    const r = await run(s.text, s.senderId, stress);
    expect(r.decision).toBe(s.expected);
    expect(r.why.proposal?.decision?.value).toBe("resolve");
    expect(r.why.guard.outcome).toBe(s.expected === "resolve" ? "agreed" : "overridden");
    // Every rogue rewrite is caught and the approved template is sent instead.
    expect(r.why.phrasing.engine).toBe("template");
    expect(r.why.phrasing.rejectedDraft).toBeTruthy();
    expect(r.why.phrasing.issues.length).toBeGreaterThan(0);
    expect(r.reply.text).toBe(r.reply.text.trim());
  });

  it("the leaked address never reaches the customer", async () => {
    const r = await run(SCENARIOS[3].text, "dren", stress);
    expect(r.why.phrasing.issues.map((i) => i.check)).toContain("pii_leak");
    expect(r.reply.text).not.toMatch(/Rr\./);
  });
});

describe("Jev integration (mock evaluation model through AI SDK evaluate)", () => {
  it("agreeing proposals pass straight through", async () => {
    const r = await run(SCENARIOS[0].text, "blerta", withJev(jevAnswers("order_status", "resolve")));
    expect(r.decision).toBe("resolve");
    expect(r.why.guard.outcome).toBe("agreed");
    expect(r.engines.decision).toBe("jev-mock");
  });

  it("a Jev failure falls back to rules", async () => {
    const failing = new MockEvaluationModel({
      doEvaluate: async () => {
        throw new Error("gateway timeout");
      },
    });
    const r = await run(SCENARIOS[3].text, "dren", { now: NOW, proposer: jevProposer(failing), phraser: null });
    expect(r.decision).toBe("request_verification");
    expect(r.why.guard.outcome).toBe("model_unavailable");
  });

  it("Jev can add caution: a frustration flag the keywords missed escalates", async () => {
    const r = await run(
      "Where is my order #1052? This is getting old.",
      "vjosa",
      withJev(jevAnswers("order_status", "resolve", { frustrated: 0.87 })),
    );
    expect(r.decision).toBe("escalate");
    expect(r.why.checks.find((c) => c.id === "R1")?.detail).toMatch(/Jev/);
  });

  it("Jev can't clear a risk: low flags don't undo the keyword reader", async () => {
    const r = await run(SCENARIOS[2].text, "gentrit", withJev(jevAnswers("product_fault", "resolve", {}, 0.99)));
    expect(r.decision).toBe("escalate");
    expect(r.why.guard.outcome).toBe("overridden");
  });

  it("an unsure Jev hands the case to a human", async () => {
    const r = await run(SCENARIOS[0].text, "blerta", withJev(jevAnswers("order_status", "resolve", {}, 0.4)));
    expect(r.decision).toBe("escalate");
    expect(r.why.guard.outcome).toBe("low_confidence");
  });

  it("readers disagreeing on the topic escalates", async () => {
    const r = await run(SCENARIOS[1].text, "leon", withJev(jevAnswers("product_fault", "resolve")));
    expect(r.decision).toBe("escalate");
    expect(r.why.guard.note).toMatch(/disagree/);
  });

  it("Jev mapping installments to 'payment methods' still can't make the agent answer", async () => {
    const r = await run(SCENARIOS[4].text, "albina", withJev(jevAnswers("payment_methods", "resolve", {}, 0.97)));
    expect(r.decision).toBe("escalate");
  });
});

describe("privacy rule", () => {
  const ask = "What's the address on order #1031?";

  it("the buyer writing from the registered Viber number gets the address", async () => {
    const r = await run(ask, "arben");
    expect(r.decision).toBe("resolve");
    expect(r.reply.text).toContain(arben.buyer.address);
  });

  it("stating both the buyer's email and phone verifies a new contact", async () => {
    const r = await run(`${ask} My email is ${arben.buyer.email} and phone ${arben.buyer.phone}`, "guest");
    expect(r.decision).toBe("resolve");
  });

  it("only one matching contact is not enough", async () => {
    const r = await run(`${ask} My email is ${arben.buyer.email}`, "guest");
    expect(r.decision).toBe("request_verification");
    expect(r.reply.text).not.toContain("Agim Ramadani");
  });

  it("a self-declared third party is never verified, even with the right details", async () => {
    const r = await run(`Arben's brother here. ${ask} His email is ${arben.buyer.email}, phone ${arben.buyer.phone}`, "dren");
    expect(r.decision).toBe("request_verification");
  });

  it("the third-party claim sticks for the rest of the thread", async () => {
    const thread: ThreadMessage[] = [
      { senderId: "dren", text: SCENARIOS[3].text, decision: "request_verification" },
    ];
    const r = await run(`ok, email ${arben.buyer.email} phone ${arben.buyer.phone}, now what's the address on #1031?`, "dren", RULES_ONLY, thread);
    expect(r.decision).toBe("request_verification");
    expect(r.reply.text).not.toContain("Agim Ramadani");
  });
});

describe("other policy paths", () => {
  it.each([
    ["Where is my order #1039?", "driton", "escalate", "R5"],
    ["Kur vjen porosia #1052?", "vjosa", "resolve", "R6"],
    ["Where is order #9999?", "guest", "request_verification", "R4"],
    ["What are your opening hours?", "guest", "resolve", "R6"],
    ["Can I pay by card?", "guest", "resolve", "R6"],
    ["Can I pay in installments?", "guest", "escalate", "R2"],
    ["Do you do trade-in for old phones?", "guest", "escalate", "R2"],
    ["I'd like to return my AirPods, they're still sealed.", "vjosa", "resolve", "R6"],
    ["Can I return headphones after 10 days? Unopened.", "guest", "request_verification", "R4"],
    ["My laptop won't turn on", "gentrit", "escalate", "R1"],
    ["Kufjet nuk punojnë", "leon", "resolve", "R6"],
  ] as const)("%s (%s) → %s via %s", async (text, sender, decision, rule) => {
    const r = await run(text, sender);
    expect(r.decision).toBe(decision);
    expect(r.why.firedRule.id).toBe(rule);
  });
});

describe("reply validator", () => {
  it("accepts a faithful rewrite and rejects an invented promise", async () => {
    const r = await run(SCENARIOS[0].text, "blerta");
    const brief = {
      kind: "order_late" as const,
      decision: "resolve" as const,
      outcome: "",
      params: { orderId: "1048", days: 6, daysLate: 2, windowMin: 2, windowMax: 4, traceId: "TRC-1048", traceHours: 24, humanAfterDays: 10, lastScanDays: 3 },
      disclose: [],
      withhold: ["Rr. Luan Haradinaj 33, Prishtinë"],
    };
    const draft = renderDraft(brief, "sq");
    const faithful =
      "Përshëndetje! Na vjen keq për vonesën: porosia #1048 u bë para 6 ditësh, 2 ditë përtej afatit 2–4 ditësh. Kemi hapur kërkimin TRC-1048 te korrieri dhe do t'ju njoftojmë brenda 24 orëve. Nëse nuk arrin deri në ditën e 10-të, një koleg do t'ju kontaktojë për rimbursim ose zëvendësim.";
    expect(validateReply(faithful, brief, draft, "sq")).toEqual([]);
    const sneaky = faithful + " Si kompensim ju japim një kupon.";
    expect(validateReply(sneaky, brief, draft, "sq").map((i) => i.check)).toContain("new_commitment");
    expect(validateReply("Hi! Your order #1048 is running late, we are sorry about that.", brief, draft, "sq").map((i) => i.check)).toContain("wrong_language");
    expect(r.reply.text).toContain("TRC-1048");
  });

  it("a phraser that throws falls back to the template", async () => {
    const broken: Phraser = {
      name: "broken",
      phrase: async () => {
        throw new Error("boom");
      },
    };
    const r = await run(SCENARIOS[4].text, "albina", { now: NOW, proposer: null, phraser: broken });
    expect(r.why.phrasing.engine).toBe("template");
    expect(r.why.phrasing.issues[0].check).toBe("model_error");
    expect(r.decision).toBe("escalate");
  });

  it("rogue phraser is actually rogue (sanity check)", async () => {
    const out = await roguePhraser.phrase({
      brief: { kind: "escalate_policy_gap", decision: "escalate", outcome: "", params: {}, disclose: [], withhold: [] },
      draft: "",
      language: "sq",
      customerText: "",
    });
    expect(out).toMatch(/^Po/);
  });
});

describe("Groq fallback (mock language model through AI SDK generateText)", () => {
  function groqMock(json: Record<string, unknown> | string) {
    return new MockLanguageModelV4({
      provider: "groq",
      modelId: "mock",
      doGenerate: async () => ({
        content: [{ type: "text", text: typeof json === "string" ? json : JSON.stringify(json) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        warnings: [],
      }),
    });
  }
  const groqDeps = (json: Record<string, unknown> | string): PipelineDeps => ({
    now: NOW,
    proposer: (state) => proposeWithLanguageModel(groqMock(json), state, "groq/mock", "Groq"),
    phraser: null,
  });
  const answer = (intent: string, decision: string, extra: Record<string, number> = {}) => ({
    intent,
    intent_confidence: 0.9,
    frustrated: 0.02,
    repeat_contact: 0.02,
    third_party: 0.02,
    wants_personal_data: 0.02,
    decision,
    decision_confidence: 0.9,
    ...extra,
  });

  it("an agreeing Groq proposal passes through", async () => {
    const r = await run(SCENARIOS[0].text, "blerta", groqDeps(answer("order_status", "resolve")));
    expect(r.decision).toBe("resolve");
    expect(r.why.guard.outcome).toBe("agreed");
    expect(r.why.proposal?.name).toBe("Groq");
  });

  it("an overconfident Groq can't release personal data", async () => {
    const r = await run(SCENARIOS[3].text, "dren", groqDeps(answer("personal_data_request", "resolve", { decision_confidence: 0.99 })));
    expect(r.decision).toBe("request_verification");
    expect(r.why.guard.outcome).toBe("overridden");
    expect(r.why.guard.note).toMatch(/^Groq proposed/);
  });

  it("a label outside the fixed list is rejected and rules decide", async () => {
    const r = await run(SCENARIOS[4].text, "albina", groqDeps(answer("installment_plan", "approve")));
    expect(r.why.proposal?.ok).toBe(false);
    expect(r.why.guard.outcome).toBe("model_unavailable");
    expect(r.decision).toBe("escalate");
  });

  it("Groq can still add caution", async () => {
    const r = await run("Kur vjen porosia #1052?", "vjosa", groqDeps(answer("order_status", "resolve", { frustrated: 0.8 })));
    expect(r.decision).toBe("escalate");
  });
});

describe("engine selection", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("uses Jev when a gateway key exists, else Groq, else rules", () => {
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
    delete process.env.GROQ_API_KEY;
    expect(decisionProvider()).toBe("rules");
    process.env.GROQ_API_KEY = "test";
    expect(decisionProvider()).toBe("groq");
    expect(phrasingProvider()).toBe("groq");
    process.env.AI_GATEWAY_API_KEY = "test";
    expect(decisionProvider()).toBe("jev");
    expect(phrasingProvider()).toBe("gateway");
  });
});

describe("conversation", () => {
  it.each([
    ["hello", "blerta", "en"],
    ["Përshëndetje", "albina", "sq"],
    ["what can you do?", "guest", "en"],
    ["faleminderit!", "leon", "sq"],
  ] as const)("“%s” gets a friendly reply, not an escalation", async (text, sender, lang) => {
    const r = await run(text, sender);
    expect(r.decision).toBe("resolve");
    expect(r.why.guard.rulesDecision).toBe("resolve");
    expect(r.reply.language).toBe(lang);
    expect(r.why.handoff).toBeUndefined();
  });

  it("a follow-up keeps the order from earlier in the chat", async () => {
    const thread: ThreadMessage[] = [{ senderId: "arben", text: "cili eshte statusi i kesaj porosie #1031", decision: "resolve" }];
    const r = await run("nuk mund ta gjej", "arben", RULES_ONLY, thread);
    expect(r.decision).toBe("escalate");
    expect(r.why.firedRule.id).toBe("R5");
    expect(r.reply.text).toContain("#1031");
    expect(r.why.actions.map((a) => a.label)).toContain("Courier delivery check opened");
    expect(r.reply.text).not.toContain("Agim Ramadani");
  });

  it("small talk still can't hide anger", async () => {
    const r = await run("hello?? NOBODY answers!!", "blerta");
    expect(r.decision).toBe("escalate");
  });
});

describe("each customer only sees their own orders", () => {
  it.each([
    ["dren", "Where is my order?", "resolve", "#1063"],
    ["dren", "Ku është porosia ime?", "resolve", "#1063"],
    ["albina", "What's the status of my order?", "resolve", "#1057"],
    ["blerta", "What's the status of order #1063?", "request_verification", "#1063"],
    ["dren", "cili eshte statusi i porosise #1031", "request_verification", "#1031"],
    ["leon", "I want to return order #1048", "request_verification", "#1048"],
  ] as const)("%s: “%s” → %s", async (sender, text, decision, orderRef) => {
    const r = await run(text, sender);
    expect(r.decision).toBe(decision);
    expect(r.reply.text).toContain(orderRef);
    if (decision === "request_verification") {
      expect(r.why.firedRule.id).toBe("R3");
      // No status leaks: nothing about transit, delivery or the item.
      expect(r.reply.text).not.toMatch(/transit|delivered|dorëzuar|transport|Xiaomi|Samsung/i);
    }
  });

  it("the linked Instagram account counts as the buyer", async () => {
    const r = await run("Where is my order?", "dren");
    expect(r.why.facts.find((f) => f.label === "Requester = buyer?")?.value ?? "").toBe("");
    expect(r.why.checks.find((c) => c.id === "R3")?.status).toBe("passed");
  });
});
