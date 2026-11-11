import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, DemoTag, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { requireCtx } from "@/server/auth";
import { listProjects } from "@/server/services/projects";
import { NewProjectForm } from "./new-project-form";

export const metadata = { title: "Architecture Finder" };

export default async function FinderPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const ctx = await requireCtx();
  const showArchived = (await searchParams).archived === "1";
  const projects = await listProjects(ctx, { includeArchived: showArchived });
  return (
    <>
      <PageHeader title="Architecture Finder" description="Describe a project, review the extracted requirements, and get ranked reference architectures with the reasons, gaps and sources behind every score." />
      <div className="cols">
        <Card title="Start a project">
          <NewProjectForm />
        </Card>
        <Card title="Projects" aside={<Link href={showArchived ? "/finder" : "/finder?archived=1"} className="muted">{showArchived ? "Hide archived" : "Show archived"}</Link>}>
          {projects.length === 0 ? (
            <EmptyState title="No projects yet">Fill in the form to create your first project. You only need a name and a few sentences of context.</EmptyState>
          ) : (
            <div className="stack" style={{ gap: 9 }}>
              {projects.map(({ project, requirementCount, approvedVersion }) => (
                <Link key={project.id} href={`/projects/${project.id}`} className="task">
                  <div style={{ minWidth: 0 }}>
                    <h3>{project.name} {project.isDemo && <DemoTag />}</h3>
                    <p>
                      {requirementCount} stated requirement{requirementCount === 1 ? "" : "s"} · updated {formatDate(project.updatedAt)}
                    </p>
                    <p style={{ marginTop: 6 }}>
                      {project.status === "archived" ? <StatusBadge status="archived" /> : approvedVersion ? <StatusBadge status="approved" label={`Blueprint v${approvedVersion} approved`} /> : <StatusBadge status={project.requirementsStatus === "approved" ? "approved" : "draft"} label={`Requirements: ${project.requirementsStatus === "none" ? "not started" : project.requirementsStatus}`} />}
                    </p>
                  </div>
                  <ChevronRight className="arrow" aria-hidden />
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
