import { PageHeader } from "@/components/ui";
import { requireCtx } from "@/server/auth";
import { GraphExplorer } from "./graph-explorer";

export const metadata = { title: "Knowledge Graph" };

export default async function GraphPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  await requireCtx();
  return (
    <>
      <PageHeader title="Knowledge Graph" description="How knowledge connects: scenarios, the patterns they implement, the technologies they use and the practices that apply. Select a node to see its details or focus on its neighbourhood." />
      <GraphExplorer initialFocus={(await searchParams).focus ?? null} />
    </>
  );
}
