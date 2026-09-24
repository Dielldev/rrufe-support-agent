import { groqConfigured, groqModelId, groqPhrasingModelId } from "./groq";
import { JEV_MODEL_ID } from "./jev";
import { DEFAULT_PHRASING_MODEL } from "./phrasing";

export type DecisionProvider = "jev" | "groq" | "rules";
export type PhrasingProvider = "gateway" | "groq" | "templates";

export interface EngineStatus {
  gateway: boolean;
  groq: boolean;
  fallbackAllowed: boolean;
  decision: { live: boolean; provider: DecisionProvider; label: string };
  phrasing: { live: boolean; provider: PhrasingProvider; label: string };
}

/**
 * AI Gateway (and so Jev) is used only when you opt in: an explicit API key, or
 * USE_AI_GATEWAY=1 to rely on the OIDC token Vercel injects into every
 * deployment. The token's mere presence doesn't switch engines.
 */
export function gatewayConfigured(): boolean {
  if (process.env.AI_GATEWAY_API_KEY) return true;
  return process.env.USE_AI_GATEWAY === "1" && Boolean(process.env.VERCEL_OIDC_TOKEN);
}

/**
 * Fallback mode determines whether pre-approved regex/template drafts are
 * returned when no phrasing model is configured or when model calls fail.
 * Default is FALSE (disabled) so tests and live chats evaluate pure AI responses.
 */
export function fallbackEnabled(override?: boolean | string | null): boolean {
  if (override !== undefined && override !== null) {
    if (typeof override === "boolean") return override;
    return override === "1" || override === "true";
  }
  if (process.env.ALLOW_TEMPLATE_FALLBACK !== undefined) {
    return process.env.ALLOW_TEMPLATE_FALLBACK === "1" || process.env.ALLOW_TEMPLATE_FALLBACK === "true";
  }
  return false;
}

/**
 * The engine picks itself from whatever keys exist: Jev when the gateway is
 * configured, otherwise Groq, otherwise the deterministic rules alone.
 */
export function decisionProvider(): DecisionProvider {
  if (gatewayConfigured() && process.env.JEV_DISABLED !== "1") return "jev";
  if (groqConfigured() && process.env.GROQ_DISABLED !== "1") return "groq";
  return "rules";
}

export function phrasingProvider(): PhrasingProvider {
  if (process.env.PHRASING_DISABLED === "1") return "templates";
  if (gatewayConfigured()) return "gateway";
  if (groqConfigured() && process.env.GROQ_DISABLED !== "1") return "groq";
  return "templates";
}

export function engineStatus(fallbackOverride?: boolean | string | null): EngineStatus {
  const decision = decisionProvider();
  const phrasing = phrasingProvider();
  const fallback = fallbackEnabled(fallbackOverride);
  return {
    gateway: gatewayConfigured(),
    groq: groqConfigured(),
    fallbackAllowed: fallback,
    decision: {
      live: decision !== "rules",
      provider: decision,
      label:
        decision === "jev" ? `Jev (${JEV_MODEL_ID}) + rules guard` : decision === "groq" ? `Groq (${groqModelId()}) + rules guard` : "Rules only",
    },
    phrasing: {
      live: phrasing !== "templates",
      provider: phrasing,
      label:
        phrasing === "gateway"
          ? process.env.PHRASING_MODEL || DEFAULT_PHRASING_MODEL
          : phrasing === "groq"
            ? `Groq (${groqPhrasingModelId()})`
            : fallback
              ? "Approved templates (Fallback enabled)"
              : "Disabled (Pure AI required)",
    },
  };
}
