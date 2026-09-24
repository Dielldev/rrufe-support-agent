import { recordTriage, resolveSender } from "@/lib/db/repo";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { depsForMode, runPipeline } from "@/lib/engine/pipeline";
import { DECISIONS, type Decision, type RunMode, type ThreadMessage } from "@/lib/engine/types";
import { shopNow } from "@/lib/shop/operations";

interface TriageRequest {
  text: string;
  senderId: string;
  mode?: RunMode;
  thread?: ThreadMessage[];
  /** Write the message and decision to the database (default true for normal chat). */
  record: boolean;
}

function parse(body: unknown): TriageRequest | string {
  if (!body || typeof body !== "object") return "Body must be JSON";
  const b = body as Record<string, unknown>;
  if (typeof b.text !== "string" || !b.text.trim()) return "`text` is required";
  if (b.text.length > 1000) return "`text` is limited to 1000 characters";
  if (typeof b.senderId !== "string" || !b.senderId.trim()) return "`senderId` is required";
  if (b.mode !== undefined && b.mode !== "standard" && b.mode !== "stress") return "`mode` must be standard or stress";
  if (b.record !== undefined && typeof b.record !== "boolean") return "`record` must be a boolean";
  const thread = Array.isArray(b.thread) ? b.thread.slice(-30) : [];
  return {
    text: b.text.trim(),
    senderId: b.senderId.trim(),
    mode: b.mode as RunMode | undefined,
    record: b.record !== false,
    // The client-held thread can only make decisions stricter (repeat contact,
    // third-party claims), so it's accepted as-is after shape checks.
    thread: thread
      .filter((m): m is ThreadMessage => typeof m?.senderId === "string" && typeof m?.text === "string")
      .map((m) => ({
        senderId: m.senderId,
        text: m.text.slice(0, 1000),
        decision: DECISIONS.includes(m.decision as Decision) ? m.decision : undefined,
      })),
  };
}

const MAX_BODY_BYTES = 32_000;

export async function POST(request: Request) {
  // Each message can trigger two model calls, so cap how fast one visitor can send.
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
    const result = await runPipeline({ text: parsed.text, sender, thread: parsed.thread ?? [] }, { ...depsForMode(mode), now });

    // Real conversations go into the audit trail. Stress runs and test-suite runs don't.
    if (mode === "standard" && parsed.record && process.env.DB_RECORD_DECISIONS !== "0") {
      try {
        result.audit = { convId: await recordTriage({ sender, text: parsed.text, result, now }) };
      } catch (err) {
        console.error("[triage] could not write the audit log", err);
        result.audit = { error: "The decision could not be written to the database." };
      }
    }
    return Response.json(result);
  } catch (err) {
    console.error("[triage] pipeline failed", err);
    return Response.json({ error: "The shop database is unavailable. Check DATABASE_URL and try again." }, { status: 503 });
  }
}
