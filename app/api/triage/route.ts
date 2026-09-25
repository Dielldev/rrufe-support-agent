import { cookies } from "next/headers";
import { recordTriage, resolveSender } from "@/lib/db/repo";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { fallbackEnabled } from "@/lib/engine/config";
import { depsForMode, runPipeline } from "@/lib/engine/pipeline";
import { DECISIONS, type Decision, type ProgressEvent, type RunMode, type ThreadMessage } from "@/lib/engine/types";
import { shopNow } from "@/lib/shop/operations";

interface TriageRequest {
  text: string;
  senderId: string;
  mode?: RunMode;
  thread?: ThreadMessage[];
  /** Write the message and decision to the database (default true for normal chat). */
  record: boolean;
  /** Stream progress as NDJSON (one ProgressEvent per line, then {type:"result"}). */
  stream: boolean;
}

function parse(body: unknown): TriageRequest | string {
  if (!body || typeof body !== "object") return "Body must be JSON";
  const b = body as Record<string, unknown>;
  if (typeof b.text !== "string" || !b.text.trim()) return "`text` is required";
  if (b.text.length > 1000) return "`text` is limited to 1000 characters";
  if (typeof b.senderId !== "string" || !b.senderId.trim()) return "`senderId` is required";
  if (b.mode !== undefined && b.mode !== "standard" && b.mode !== "stress") return "`mode` must be standard or stress";
  if (b.record !== undefined && typeof b.record !== "boolean") return "`record` must be a boolean";
  if (b.stream !== undefined && typeof b.stream !== "boolean") return "`stream` must be a boolean";
  const thread = Array.isArray(b.thread) ? b.thread.slice(-30) : [];
  return {
    text: b.text.trim(),
    senderId: b.senderId.trim(),
    mode: b.mode as RunMode | undefined,
    record: b.record !== false,
    stream: b.stream === true,
    // The client-held thread can only make decisions stricter (repeat contact,
    // third-party claims), so it's accepted as-is after shape checks. Earlier
    // replies are conversation context for the agent, never facts: every fact in
    // a new reply has to come from this turn's tool results.
    thread: thread
      .filter((m): m is ThreadMessage => typeof m?.senderId === "string" && typeof m?.text === "string")
      .map((m) => ({
        senderId: m.senderId,
        text: m.text.slice(0, 1000),
        decision: DECISIONS.includes(m.decision as Decision) ? m.decision : undefined,
        reply: typeof m.reply === "string" ? m.reply.slice(0, 1500) : undefined,
      })),
  };
}

// 30 thread messages × (1,000 chars of text + 1,500 of reply) plus the new message.
const MAX_BODY_BYTES = 96_000;

export async function POST(request: Request) {
  // Each message can trigger several model calls (classifier + agent loop), so cap how fast one visitor can send.
  const limit = rateLimit(clientKey(request), 20, 60_000);
  if (!limit.ok) {
    return Response.json(
      { error: `Too many messages — try again in ${limit.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "Request too large" }, { status: 413 });

  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // handled by parse()
  }
  const parsed = parse(body);
  if (typeof parsed === "string") return Response.json({ error: parsed }, { status: 400 });

  try {
    const sender = await resolveSender(parsed.senderId);
    if (!sender) return Response.json({ error: "Unknown `senderId` — use channel:handle, e.g. viber:+38344100101" }, { status: 400 });

    const mode = parsed.mode ?? "standard";
    const now = shopNow();

    const jar = await cookies();
    const fallbackCookie = jar.get("rrufe_allow_fallback")?.value;
    const allowFallback = fallbackEnabled(fallbackCookie);

    const handle = async (onEvent?: (e: ProgressEvent) => void) => {
      const result = await runPipeline(
        { text: parsed.text, sender, thread: parsed.thread ?? [] },
        // The stress test exists to show rogue output being replaced by the approved template.
        { ...depsForMode(mode, allowFallback), now, allowFallback: mode === "stress" || allowFallback, onEvent },
      );
      // Real conversations go into the audit trail. Stress runs and test-suite runs don't.
      if (mode === "standard" && parsed.record && process.env.DB_RECORD_DECISIONS !== "0") {
        try {
          result.audit = { convId: await recordTriage({ sender, text: parsed.text, result, now }) };
        } catch (err) {
          console.error("[triage] could not write the audit log", err);
          result.audit = { error: "The decision could not be written to the database." };
        }
      }
      return result;
    };

    if (!parsed.stream) return Response.json(await handle());

    // NDJSON: progress events as they happen, then the full result. Reply text
    // only appears here after it has passed the output checks.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        try {
          send({ type: "result", result: await handle(send) });
        } catch (err) {
          console.error("[triage] pipeline failed", err);
          send({ type: "error", error: err instanceof Error ? err.message : "The shop database or triage service is unavailable." });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
    });
  } catch (err) {
    console.error("[triage] pipeline failed", err);
    const message = err instanceof Error ? err.message : "The shop database or triage service is unavailable.";
    return Response.json({ error: message }, { status: 500 });
  }
}
