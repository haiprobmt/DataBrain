import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Card, DemoTag, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireCtx } from "@/server/auth";
import { listProjects } from "@/server/services/projects";

const MODULES: Record<string, { title: string; description: string }> = {
  blueprint: { title: "Solution Blueprint", description: "The versioned architecture for a project: editable diagram, design sections and decision records. Choose a project to open its blueprint." },
  artifacts: { title: "Artifact Factory", description: "Documents, diagrams, IaC starters and plans generated from an approved blueprint. Choose a project." },
  skills: { title: "AI Skill Factory", description: "Agent skill packages composed from an approved blueprint and the knowledge behind it. Choose a project." },
  deployments: { title: "Deployment Studio", description: "Dry-run plans, approval gates and evidence. Choose a project." },
};

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }) {
  return { title: MODULES[(await params).module]?.title ?? "Not found" };
}

export default async function StudioPage({ params }: { params: Promise<{ module: string }> }) {
  const ctx = await requireCtx();
  const { module } = await params;
  const def = MODULES[module];
  if (!def) notFound();
  const projects = await listProjects(ctx);
  return (
    <>
      <PageHeader title={def.title} description={def.description} />
      <Card title="Projects">
        {projects.length === 0 ? (
          <EmptyState title="No projects yet" action={<Link href="/finder" className="btn primary">Start in the Architecture Finder</Link>}>{def.title} works on a project. Create one, approve its requirements and pick an architecture first.</EmptyState>
        ) : (
          <div className="stack" style={{ gap: 9 }}>
            {projects.map(({ project, approvedVersion, revisionCount }) => (
              <Link key={project.id} href={`/projects/${project.id}/${module}`} className="task">
                <div>
                  <h3>{project.name} {project.isDemo && <DemoTag />}</h3>
                  <p style={{ marginTop: 5 }}>{approvedVersion ? <StatusBadge status="approved" label={`Blueprint v${approvedVersion} approved`} /> : revisionCount ? <StatusBadge status="draft" label="Blueprint in draft" /> : <StatusBadge status="draft" label="No blueprint yet" />}</p>
                </div>
                <ChevronRight className="arrow" aria-hidden />
              </Link>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
