import { requireCtx } from "@/server/auth";
import { listManifests } from "@/server/services/artifacts";
import { getDeploymentAdapter } from "@/server/providers";
import { listDeployments } from "@/server/services/deployments";
import { listEnvironments } from "@/server/services/projects";
import { DeploymentStudio } from "./deployment-studio";

export const metadata = { title: "Deployment Studio" };

export default async function DeploymentsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const [environments, manifests, deployments] = await Promise.all([listEnvironments(ctx, projectId), listManifests(ctx, projectId), listDeployments(ctx, projectId)]);
  const adapter = getDeploymentAdapter();
  return (
    <DeploymentStudio
      projectId={projectId}
      readOnly={ctx.role === "viewer"}
      canApprove={ctx.role === "owner"}
      adapter={{ name: adapter.name, simulated: adapter.simulated, operations: adapter.capabilities.supportedOperations, rollbackLimitations: adapter.capabilities.rollbackLimitations }}
      environments={environments.map((e) => ({ id: e.id, name: e.name, kind: e.kind, platform: e.platform }))}
      manifests={manifests.map((m) => ({ id: m.id, label: `Blueprint v${m.body.architectureRevisionVersion} · ${m.body.files.length} files · ${m.hash.slice(0, 8)}`, createdAt: m.createdAt.toISOString() }))}
      plans={deployments.map((d) => ({
        id: d.plan.id,
        planHash: d.plan.planHash,
        status: d.plan.status,
        createdAt: d.plan.createdAt.toISOString(),
        body: d.plan.body,
        runs: d.runs.map((r) => ({ id: r.id, mode: r.mode, status: r.status, simulated: r.simulated, summary: r.summary, createdAt: r.createdAt.toISOString() })),
        approvals: d.approvals.map((a) => ({ id: a.id, status: a.status, note: a.note, expiresAt: a.expiresAt.toISOString(), createdAt: a.createdAt.toISOString() })),
      }))}
    />
  );
}
