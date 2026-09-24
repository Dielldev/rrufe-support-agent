import { groqConfigured, groqModelId, groqPhrasingModelId } from "./groq";
import { JEV_MODEL_ID } from "./jev";
import { DEFAULT_PHRASING_MODEL } from "./phrasing";

export type DecisionProvider = "jev" | "groq" | "rules";
export type PhrasingProvider = "gateway" | "groq" | "templates";

export interface EngineStatus {
  gateway: boolean;
  groq: boolean;
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

export function engineStatus(): EngineStatus {
  const decision = decisionProvider();
  const phrasing = phrasingProvider();
  return {
    gateway: gatewayConfigured(),
    groq: groqConfigured(),
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
            : "Approved templates",
    },
  };
}
