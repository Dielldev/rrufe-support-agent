import type { Metadata } from "next";
import { TestRunner } from "@/components/tests/TestRunner";

export const metadata: Metadata = { title: "Tests · Rrufe Support" };

export default function TestsPage() {
  return <TestRunner />;
}
