import { agentMap } from "@/lib/agent/map";

export async function GET() {
  return Response.json(await agentMap(), { headers: { "Cache-Control": "no-store" } });
}
