import { requireCtx } from "@/server/auth";
import { listMembers, listMilestones, listRisks } from "@/server/services/lifecycle";
import { getProject } from "@/server/services/projects";
import { MilestonesPanel } from "./milestones-panel";
import { RisksPanel } from "./risks-panel";

export const metadata = { title: "Milestones & Risks" };

export default async function MilestonesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const [project, milestones, risks, members] = await Promise.all([getProject(ctx, projectId), listMilestones(ctx, projectId), listRisks(ctx, projectId), listMembers(ctx)]);
  const editable = ctx.role !== "viewer" && project.status !== "archived";
  const options = members.map((m) => ({ id: m.id, name: m.name, role: m.role }));
  return (
    <div className="stack">
      <MilestonesPanel projectId={projectId} milestones={milestones} members={options} editable={editable} />
      <RisksPanel projectId={projectId} risks={risks} members={options} editable={editable} />
    </div>
  );
}
