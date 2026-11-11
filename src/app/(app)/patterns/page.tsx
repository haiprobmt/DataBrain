import Link from "next/link";
import { KnowledgeListView } from "@/components/knowledge/list-view";
import { PageHeader } from "@/components/ui";
import { requireCtx } from "@/server/auth";

export const metadata = { title: "Architecture Patterns" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; status?: string; page?: string }> }) {
  const ctx = await requireCtx();
  return (
    <>
      <PageHeader title="Architecture Patterns" description="Reusable design patterns that scenarios implement. They are pulled into recommendations through their relationships." actions={ctx.role !== "viewer" && <Link href="/knowledge/new?type=architecture-pattern" className="btn primary">New pattern</Link>} />
      <KnowledgeListView ctx={ctx} basePath="/patterns" types={["architecture-pattern", "best-practice"]} query={await searchParams} emptyTitle="No patterns yet" emptyText="Add a pattern and link it to the scenarios that implement it." newHref="/knowledge/new?type=architecture-pattern" />
    </>
  );
}
