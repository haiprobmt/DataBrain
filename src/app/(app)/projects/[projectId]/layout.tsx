import type { ReactNode } from "react";
import { DemoTag, StatusBadge } from "@/components/ui";
import { requireCtx } from "@/server/auth";
import { getApprovedRevision } from "@/server/services/blueprint";
import { getProject } from "@/server/services/projects";
import { ProjectTabs } from "./project-tabs";
import { notFound } from "next/navigation";
import { AppError } from "@/server/errors";

export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ projectId: string }> }) {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = await getProject(ctx, projectId).catch((error) => {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  });
  const approved = await getApprovedRevision(ctx, projectId);
  return (
    <>
      <div className="pagehead" style={{ marginBottom: 12 }}>
        <div>
          <p className="muted" style={{ margin: 0 }}>Project</p>
          <h1>{project.name} {project.isDemo && <DemoTag />}</h1>
          {project.description && <p>{project.description}</p>}
        </div>
        <div className="actions">
          {project.status === "archived" && <StatusBadge status="archived" />}
          <StatusBadge status={project.requirementsStatus === "approved" ? "approved" : "draft"} label={`Requirements: ${project.requirementsStatus === "none" ? "not started" : project.requirementsStatus}`} />
          {approved ? <StatusBadge status="approved" label={`Blueprint v${approved.version} approved`} /> : <StatusBadge status="draft" label="No approved blueprint" />}
        </div>
      </div>
      <ProjectTabs projectId={projectId} />
      {children}
    </>
  );
}
