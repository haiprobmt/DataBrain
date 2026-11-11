import { ItemForm } from "@/components/knowledge/item-form";
import { PageHeader } from "@/components/ui";
import { KNOWLEDGE_TYPE_KEYS } from "@/lib/catalog";
import { requireCtx } from "@/server/auth";

export const metadata = { title: "New knowledge item" };

export default async function NewKnowledgePage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requireCtx();
  const wanted = (await searchParams).type ?? "";
  const type = (KNOWLEDGE_TYPE_KEYS as string[]).includes(wanted) ? wanted : "concept";
  return (
    <>
      <PageHeader title="New knowledge item" description="New items start as drafts. Add sources, then mark the item reviewed or verified." />
      <ItemForm cancelHref="/knowledge" initial={{ title: "", type, summary: "", tags: [], sourceType: "unspecified", confidence: null, sections: [], attributes: {} }} />
    </>
  );
}
