import { agentModelId, groqAgentModelId, openRouterModelIds } from "@/lib/agent/models";
import { groqConfigured, groqModelId, groqPhrasingModelId } from "./groq";
import { JEV_MODEL_ID } from "./jev";
import { DEFAULT_PHRASING_MODEL } from "./phrasing";

export type DecisionProvider = "jev" | "openrouter" | "groq" | "rules";
export type PhrasingProvider = "gateway" | "openrouter" | "groq" | "templates";
export type AgentProvider = "openrouter" | "gateway" | "groq" | "none";

export interface EngineStatus {
  gateway: boolean;
  openrouter: boolean;
  groq: boolean;
  fallbackAllowed: boolean;
  decision: { live: boolean; provider: DecisionProvider; label: string };
  phrasing: { live: boolean; provider: PhrasingProvider; label: string };
  agent: { live: boolean; provider: AgentProvider; label: string };
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

export function openRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
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
 * configured, otherwise OpenRouter, otherwise Groq, otherwise the deterministic rules alone.
 */
export function decisionProvider(): DecisionProvider {
  if (gatewayConfigured() && process.env.JEV_DISABLED !== "1") return "jev";
  if (openRouterConfigured() && process.env.OPENROUTER_DISABLED !== "1") return "openrouter";
  if (groqConfigured() && process.env.GROQ_DISABLED !== "1") return "groq";
  return "rules";
}

export function phrasingProvider(): PhrasingProvider {
  if (process.env.PHRASING_DISABLED === "1") return "templates";
  if (gatewayConfigured()) return "gateway";
  if (openRouterConfigured() && process.env.OPENROUTER_DISABLED !== "1") return "openrouter";
  if (groqConfigured() && process.env.GROQ_DISABLED !== "1") return "groq";
  return "templates";
}

/**
 * The tool-using agent writes the reply whenever a model with tool calling is
 * configured. Without one, the fixed rule paths and templates answer as before.
 */
export function agentProvider(): AgentProvider {
  if (process.env.AGENT_DISABLED === "1") return "none";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (gatewayConfigured()) return "gateway";
  if (groqConfigured() && process.env.GROQ_DISABLED !== "1") return "groq";
  return "none";
}

export function engineStatus(fallbackOverride?: boolean | string | null): EngineStatus {
  const decision = decisionProvider();
  const phrasing = phrasingProvider();
  const agent = agentProvider();
  const fallback = fallbackEnabled(fallbackOverride);
  return {
    gateway: gatewayConfigured(),
    openrouter: openRouterConfigured(),
    groq: groqConfigured(),
    fallbackAllowed: fallback,
    decision: {
      live: decision !== "rules",
      provider: decision,
      label:
        decision === "jev"
          ? `Jev (${JEV_MODEL_ID}) + rules guard`
          : decision === "openrouter"
            ? `OpenRouter (${openRouterModelIds()[0]}) + rules guard`
            : decision === "groq"
              ? `Groq (${groqModelId()}) + rules guard`
              : "Rules only",
    },
    phrasing: {
      live: phrasing !== "templates",
      provider: phrasing,
      label:
        phrasing === "gateway"
          ? process.env.PHRASING_MODEL || DEFAULT_PHRASING_MODEL
          : phrasing === "openrouter"
            ? `OpenRouter (${process.env.OPENROUTER_PHRASING_MODEL || openRouterModelIds()[0]})`
            : phrasing === "groq"
              ? `Groq (${groqPhrasingModelId()})`
              : fallback
                ? "Approved templates (Fallback enabled)"
                : "Disabled (Pure AI required)",
    },
    agent: {
      live: agent !== "none",
      provider: agent,
      label:
        agent === "openrouter"
          ? `OpenRouter (${openRouterModelIds().join(" → ")})${groqConfigured() && process.env.GROQ_DISABLED !== "1" ? ` → Groq (${groqAgentModelId()})` : ""} + scoped tools`
          : agent === "gateway"
          ? `${agentModelId()} + scoped tools`
          : agent === "groq"
            ? `Groq (${groqAgentModelId()}) + scoped tools`
            : "Off — fixed rule paths answer",
    },
  };
}
