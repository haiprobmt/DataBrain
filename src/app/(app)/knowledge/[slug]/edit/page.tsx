import { notFound } from "next/navigation";
import { ItemForm } from "@/components/knowledge/item-form";
import { PageHeader } from "@/components/ui";
import { requireCtx } from "@/server/auth";
import { getItem } from "@/server/services/knowledge";

export const metadata = { title: "Edit knowledge item" };

export default async function EditKnowledgePage({ params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireCtx();
  const { slug } = await params;
  const item = await getItem(ctx, slug).catch(() => null);
  if (!item) notFound();
  return (
    <>
      <PageHeader title={`Edit: ${item.title}`} description={`Version ${item.version}. Saving creates version ${item.version + 1} and keeps this one in the history.`} />
      <ItemForm cancelHref={`/knowledge/${item.slug}`} initial={{ id: item.id, version: item.version, status: item.status, title: item.title, type: item.type, summary: item.summary, tags: item.tags, sourceType: item.sourceType, confidence: item.confidence, sections: item.sections, attributes: item.attributes }} />
    </>
  );
}
