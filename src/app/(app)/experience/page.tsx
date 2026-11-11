import Link from "next/link";
import { KnowledgeListView } from "@/components/knowledge/list-view";
import { PageHeader } from "@/components/ui";
import { requireCtx } from "@/server/auth";

export const metadata = { title: "Experience Repository" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; status?: string; page?: string }> }) {
  const ctx = await requireCtx();
  return (
    <>
      <PageHeader title="Experience Repository" description="What you learned on real projects: what worked, what did not, and the evidence. Internal experience is kept distinct from vendor guidance." actions={ctx.role !== "viewer" && <Link href="/knowledge/new?type=project-experience" className="btn primary">Record experience</Link>} />
      <KnowledgeListView ctx={ctx} basePath="/experience" types={["project-experience"]} query={await searchParams} emptyTitle="No project experience recorded" emptyText="After a project, record what you would repeat and what you would change, and link it to the scenario you used." newHref="/knowledge/new?type=project-experience" />
    </>
  );
}
