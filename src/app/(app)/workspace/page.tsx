import { PageHeader } from "@/components/ui";
import { requireCtx } from "@/server/auth";
import { getLLM } from "@/server/providers";
import { AskPanel } from "./ask-panel";

export const metadata = { title: "AI Workspace" };

export default async function WorkspacePage() {
  await requireCtx();
  const llm = getLLM();
  return (
    <>
      <PageHeader title="AI Workspace" description="Ask the knowledge base a question. Answers are the best-matching passages, quoted with their sources and review status." />
      <AskPanel generative={llm.isGenerative} provider={llm.name} />
    </>
  );
}
