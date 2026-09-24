/**
 * Model provider errors can include account or organization identifiers, so
 * only a short generic reason is ever shown in the UI.
 */
export function safeModelError(err: unknown, fallback = "Model request failed"): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/rate limit|429|too many requests/i.test(msg)) return "Rate limited by the model provider";
  if (/timeout|timed out|aborted/i.test(msg)) return "Model request timed out";
  if (/api key|unauthori[sz]ed|401|403|invalid.*key/i.test(msg)) return "Model provider rejected the credentials";
  if (/schema|parse|validation|did not match|No object generated/i.test(msg)) return "Model returned an answer outside the allowed options";
  return fallback;
}
