import Link from "next/link";
import { KnowledgeListView } from "@/components/knowledge/list-view";
import { PageHeader } from "@/components/ui";
import { requireCtx } from "@/server/auth";

export const metadata = { title: "Scenarios & Playbooks" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; status?: string; page?: string }> }) {
  const ctx = await requireCtx();
  return (
    <>
      <PageHeader title="Scenarios & Playbooks" description="Reference scenarios the Architecture Finder matches against, and the playbooks for running the work. A scenario carries matching attributes and a reference diagram." actions={ctx.role !== "viewer" && <Link href="/knowledge/new?type=scenario" className="btn primary">New scenario</Link>} />
      <KnowledgeListView ctx={ctx} basePath="/scenarios" types={["scenario", "playbook"]} query={await searchParams} emptyTitle="No scenarios yet" emptyText="Scenarios are what the Architecture Finder ranks. Add one with its platforms, workloads and security coverage." newHref="/knowledge/new?type=scenario" />
    </>
  );
}
