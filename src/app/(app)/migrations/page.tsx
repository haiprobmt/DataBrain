import Link from "next/link";
import { KnowledgeListView } from "@/components/knowledge/list-view";
import { PageHeader } from "@/components/ui";
import { requireCtx } from "@/server/auth";

export const metadata = { title: "Migration Center" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; status?: string; page?: string }> }) {
  const ctx = await requireCtx();
  return (
    <>
      <PageHeader title="Migration Center" description="Migration strategies and assessment playbooks. Each workload gets one disposition — rehost, replatform, refactor, rebuild, replace, retain or retire — with its rationale recorded in the project's migration plan." actions={ctx.role !== "viewer" && <Link href="/knowledge/new?type=migration-strategy" className="btn primary">New strategy</Link>} />
      <KnowledgeListView ctx={ctx} basePath="/migrations" types={["migration-strategy", "playbook"]} query={await searchParams} emptyTitle="No migration strategies yet" emptyText="Add a strategy and link it to the scenarios that use it." newHref="/knowledge/new?type=migration-strategy" />
    </>
  );
}
