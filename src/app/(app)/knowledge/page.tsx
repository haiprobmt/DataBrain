import Link from "next/link";
import { KnowledgeListView } from "@/components/knowledge/list-view";
import { PageHeader } from "@/components/ui";
import { requireCtx } from "@/server/auth";

export const metadata = { title: "Knowledge Library" };

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; status?: string; page?: string }> }) {
  const ctx = await requireCtx();
  return (
    <>
      <PageHeader
        title="Knowledge Library"
        description="Everything DataBrain knows, with its source, review status and last verification date. Drafts are the review queue."
        actions={ctx.role !== "viewer" && (<><Link href="/knowledge/import" className="btn">Import document</Link><Link href="/knowledge/new" className="btn primary">New item</Link></>)}
      />
      <KnowledgeListView ctx={ctx} basePath="/knowledge" query={await searchParams} emptyTitle="The library is empty" emptyText="Add a knowledge item or import a Markdown document. Run “npm run db:seed” to load the demo knowledge base." newHref="/knowledge/new" />
    </>
  );
}
