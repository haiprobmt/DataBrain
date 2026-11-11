import { PageHeader } from "@/components/ui";
import { requireCtx } from "@/server/auth";
import { providerStatus } from "@/server/providers";
import { AskPanel } from "./ask-panel";

export const metadata = { title: "AI Workspace" };

export default async function WorkspacePage() {
  await requireCtx();
  const llm = providerStatus().find((p) => p.kind === "LLM");
  const generative = !!llm?.available && llm.configured !== "local";
  return (
    <>
      <PageHeader title="AI Workspace" description="Ask the knowledge base a question. Every answer is grounded in the best-matching passages, shown with their sources and review status." />
      <AskPanel generative={generative} provider={llm?.active ?? "unavailable"} unavailable={llm?.available ? null : (llm?.note ?? null)} />
    </>
  );
}
