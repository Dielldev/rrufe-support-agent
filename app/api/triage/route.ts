import { findSender } from "@/lib/data/customers";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { depsForMode, runPipeline } from "@/lib/engine/pipeline";
import { DECISIONS, type Decision, type RunMode, type ThreadMessage } from "@/lib/engine/types";

interface TriageRequest {
  text: string;
  senderId: string;
  mode?: RunMode;
  thread?: ThreadMessage[];
}

function parse(body: unknown): TriageRequest | string {
  if (!body || typeof body !== "object") return "Body must be JSON";
  const b = body as Record<string, unknown>;
  if (typeof b.text !== "string" || !b.text.trim()) return "`text` is required";
  if (b.text.length > 1000) return "`text` is limited to 1000 characters";
  if (typeof b.senderId !== "string" || !findSender(b.senderId)) return "Unknown `senderId`";
  if (b.mode !== undefined && b.mode !== "standard" && b.mode !== "stress") return "`mode` must be standard or stress";
  const thread = Array.isArray(b.thread) ? b.thread.slice(-30) : [];
  return {
    text: b.text.trim(),
    senderId: b.senderId,
    mode: b.mode as RunMode | undefined,
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

  const result = await runPipeline(
    { text: parsed.text, sender: findSender(parsed.senderId)!, thread: parsed.thread ?? [] },
    depsForMode(parsed.mode ?? "standard"),
  );
  return Response.json(result);
}
