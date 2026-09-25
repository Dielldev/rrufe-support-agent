import type { Metadata } from "next";
import { connection } from "next/server";
import { AgentMap } from "@/components/flow/AgentMap";
import { agentMap } from "@/lib/agent/map";

export const metadata: Metadata = { title: "Agent map · Rrufe Support Agent" };

export default async function FlowPage() {
  await connection();
  return <AgentMap map={await agentMap()} />;
}
