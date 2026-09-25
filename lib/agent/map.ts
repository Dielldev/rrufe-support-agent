import { getPolicyBook } from "@/lib/db/repo";
import { agentProvider, decisionProvider } from "@/lib/engine/config";
import { groqModelId } from "@/lib/engine/groq";
import { groqAgentModelId, openRouterModelIds } from "./models";
import { SKILLS } from "./prompt";
import { TOOL_NAMES } from "./tools";

type ToolName = (typeof TOOL_NAMES)[number];
export type ToolKind = "read" | "public" | "action" | "handoff";

const TOOLS: Record<ToolName, { does: string; kind: ToolKind; guard: string }> = {
  get_my_account: { does: "Reads the customer's profile", kind: "read", guard: "Own account only" },
  list_my_orders: { does: "Lists the customer's orders", kind: "read", guard: "Own account only" },
  get_order: { does: "Opens one order in full", kind: "read", guard: "Ownership re-checked" },
  search_products: { does: "Searches the catalog", kind: "public", guard: "Public data" },
  open_carrier_trace: { does: "Asks the courier to trace a parcel", kind: "action", guard: "Only if shipped and late" },
  issue_delay_voucher: { does: "Gives the delay reward", kind: "action", guard: "Late orders, one per order" },
  change_delivery_address: { does: "Changes the delivery address", kind: "action", guard: "Before shipping, customer's own words" },
  remove_order_item: { does: "Removes an item or lowers a quantity", kind: "action", guard: "Before shipping, cash on delivery" },
  cancel_order: { does: "Cancels an order", kind: "action", guard: "Before shipping, cash on delivery" },
  request_human: { does: "Hands the chat to a colleague", kind: "handoff", guard: "Rare cases only" },
};

export async function agentMap() {
  const policies = await getPolicyBook();
  const agent = agentProvider();
  const agentModels =
    agent === "openrouter"
      ? [...openRouterModelIds().map((m) => `openrouter/${m}`), `groq/${groqAgentModelId()}`]
      : agent === "groq"
        ? [`groq/${groqAgentModelId()}`]
        : agent === "gateway"
          ? ["ai-gateway"]
          : [];
  return {
    generatedAt: new Date().toISOString(),
    steps: [
      { n: 1, name: "Read the message", by: "code", does: "Language, order numbers, mood, who it's for" },
      { n: 2, name: "Check tone and risk", by: "ai", does: "Second opinion on intent and risk, in parallel" },
      { n: 3, name: "Gate", by: "code", does: "Rules decide what only a person may handle" },
      { n: 4, name: "Grant access", by: "code", does: "What this sender may see, from the inbox identity" },
      { n: 5, name: "Agent works", by: "ai", does: "Reads skills, calls tools, writes the reply" },
      { n: 6, name: "Check the reply", by: "code", does: "No leaks, no invented facts or promises" },
      { n: 7, name: "Decide and send", by: "code", does: "Answer, ask to verify, or hand off" },
    ],
    tools: TOOL_NAMES.map((name) => ({ name, ...TOOLS[name] })),
    alone: [
      "Order status, delivery dates, order history",
      "Returns: eligible or not, with the reason",
      "Courier traces and delay rewards",
      "Address changes, removing items, cancelling before shipping",
      "Products, prices, stock, payment and installment options",
      "Declining someone else's order, politely",
    ],
    human: [
      "Faulty or broken items (warranty)",
      "Refunds and any money going back",
      "Changes to an order that already shipped",
      "Courier failures and lost parcels",
      "Topics with no written policy",
      "A customer who insists on a person",
    ],
    data: {
      tables: ["customers", "orders", "order_items", "shipments", "products", "policies", "vouchers", "order_changes", "chat history"],
      policies: policies.topics,
    },
    skills: SKILLS.map((s) => ({ name: s.name, when: s.description })),
    models: { agent: agentModels, classifier: decisionProvider() === "groq" ? `groq/${groqModelId()}` : decisionProvider() },
  };
}

export type AgentMap = Awaited<ReturnType<typeof agentMap>>;
