import type { Metadata } from "next";
import { connection } from "next/server";
import { FlowExplorer, type ScenarioTrace } from "@/components/flow/FlowExplorer";
import { findSender } from "@/lib/data/customers";
import { engineStatus } from "@/lib/engine/config";
import { depsForMode, runPipeline } from "@/lib/engine/pipeline";
import { RULES } from "@/lib/engine/rules";
import { SCENARIOS } from "@/lib/scenarios";

export const metadata: Metadata = { title: "Decision flow · Rrufe Support Agent" };

export default async function FlowPage() {
  await connection();
  // Annotations are real runs of the pipeline, not hand-written copy. The
  // deterministic path runs without models so the page never waits on the network.
  const traces: ScenarioTrace[] = await Promise.all(
    SCENARIOS.map(async (scenario) => {
      const input = { text: scenario.text, sender: findSender(scenario.senderId)!, thread: [] };
      const [standard, stress] = await Promise.all([
        runPipeline(input, { proposer: null, phraser: null }),
        runPipeline(input, depsForMode("stress")),
      ]);
      return { scenario, sender: input.sender, standard, stress };
    }),
  );

  return <FlowExplorer traces={traces} rules={RULES} status={engineStatus()} />;
}
