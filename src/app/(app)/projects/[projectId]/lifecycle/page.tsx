import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, ScoreBar, StatusBadge } from "@/components/ui";
import { StartLifecycle } from "@/components/lifecycle/start-lifecycle";
import { isStageDone, statusLabel } from "@/lib/lifecycle";
import { formatDate, formatDateTime } from "@/lib/utils";
import { requireCtx } from "@/server/auth";
import { listArtifacts } from "@/server/services/artifacts";
import { getProjectLifecycle, listMembers, stageActivity } from "@/server/services/lifecycle";
import { listLifecycleTemplates } from "@/server/services/lifecycle-templates";
import { ApprovalsPanel } from "./approvals-panel";
import { ChecklistPanel } from "./checklist-panel";
import { EvidencePanel } from "./evidence-panel";
import { LifecycleControls } from "./lifecycle-controls";
import { ReadinessCard } from "./readiness-card";
import { StagePanel } from "./stage-panel";

export const metadata = { title: "Lifecycle" };

export default async function LifecyclePage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ stage?: string }> }) {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const wanted = (await searchParams).stage;
  const view = await getProjectLifecycle(ctx, projectId);
  const canEdit = ctx.role !== "viewer" && view.project.status !== "archived";

  if (!view.lifecycle || !view.progress) {
    const templates = canEdit ? (await listLifecycleTemplates(ctx)).filter((t) => t.isActive) : [];
    return (
      <Card>
        <EmptyState
          title="Lifecycle not started"
          action={canEdit ? <StartLifecycle projectId={projectId} projectName={view.project.name} templates={templates.map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault, stageCount: t.stageCount }))} /> : undefined}
        >
          This project has no lifecycle yet. Starting one copies the stages and checklists of a template into the project. Nothing is marked complete from existing requirements, blueprints or deployments — the first stage starts in progress and every gate is checked from then on.
        </EmptyState>
      </Card>
    );
  }

  const { lifecycle, progress, stages } = view;
  const stage = stages.find((s) => s.stageKey === wanted);
  if (!stage) {
    // Pin the stage in the address, so the view stays on it after an action instead of jumping to the next stage.
    const current = stages.find((s) => s.id === progress.currentStageId) ?? [...stages].reverse().find((s) => s.isRequired) ?? stages[0]!;
    redirect(`/projects/${projectId}/lifecycle?stage=${current.stageKey}`);
  }
  const [members, artifacts, activity] = await Promise.all([listMembers(ctx), listArtifacts(ctx, projectId), stageActivity(ctx, projectId, stage.id, 20)]);
  // Stage work is only possible while the lifecycle is active; the controls say why when it is not.
  const editable = canEdit && lifecycle.status === "active";
  const memberOptions = members.map((m) => ({ id: m.id, name: m.name, role: m.role }));
  // The lifecycle can be closed once every required stage is done and no optional stage is left under way.
  const canComplete = progress.requiredStagesDone === progress.requiredStages && !stages.some((s) => s.status === "in_progress" || s.status === "blocked" || s.status === "pending_approval");

  return (
    <div className="stack">
      <Card title="Lifecycle" aside={<StatusBadge status={lifecycle.status} label={statusLabel(lifecycle.status)} />}>
        <div className="gridtwo" style={{ ["--cols" as string]: "minmax(0, 1.3fr) minmax(0, 1fr)" }}>
          <div>
            <div className="meter">
              <ScoreBar value={progress.percent / 100} label="Stage completion" />
              <b>{progress.percent}%</b>
            </div>
            <p className="sub" style={{ marginTop: 8 }}>
              <strong>Stage completion:</strong> {progress.requiredStagesDone} of {progress.requiredStages} required stages completed{progress.skippedStages ? ` or skipped (${progress.skippedStages} skipped)` : ""}. Optional stages are not counted. This is not a measure of engineering effort, data quality, business value or deployment success.
            </p>
            <p className="sub">
              Checklist: {progress.checklist.satisfied} of {progress.checklist.total} items completed or waived · {progress.checklist.outstandingRequired} required item{progress.checklist.outstandingRequired === 1 ? "" : "s"} outstanding across all stages.
            </p>
          </div>
          <dl className="kv">
            <dt>Template</dt><dd>{lifecycle.templateName} · v{lifecycle.templateVersion} <span className="muted">(snapshot)</span></dd>
            <dt>Started</dt><dd>{formatDate(lifecycle.startedAt)}</dd>
            <dt>Target end</dt><dd>{formatDate(lifecycle.targetEndAt)}</dd>
            {lifecycle.completedAt && (<><dt>Completed</dt><dd>{formatDate(lifecycle.completedAt)}</dd></>)}
          </dl>
        </div>
        {canEdit && <LifecycleControls projectId={projectId} status={lifecycle.status} targetEndAt={lifecycle.targetEndAt} canComplete={canComplete} />}
        {!canEdit && lifecycle.status !== "active" && <p className="note warn" style={{ marginTop: 12 }}>This lifecycle is {statusLabel(lifecycle.status).toLowerCase()}; its stages cannot be changed.</p>}
      </Card>

      <nav aria-label="Lifecycle stages">
        <ol className="stage-steps">
          {stages.map((s, index) => {
            const problem = s.status === "blocked" || s.overdue;
            return (
              <li key={s.id}>
                <Link href={`/projects/${projectId}/lifecycle?stage=${s.stageKey}`} scroll={false} className={`stage-step${isStageDone(s.status) ? " done" : problem ? " problem" : ""}`} aria-current={s.id === stage.id ? "step" : undefined}>
                  <span className="head">
                    <span className="num" aria-hidden>{index + 1}</span>
                    <span className="name">{s.name}</span>
                  </span>
                  <span>
                    <StatusBadge status={s.status} label={statusLabel(s.status)} />
                  </span>
                  <span className="meta">
                    {s.isRequired ? "Required" : "Optional"}
                    {s.id === progress.currentStageId ? " · current" : ""}
                    {s.dueAt ? ` · due ${formatDate(s.dueAt)}` : ""}
                    {s.overdue ? " · overdue" : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="cols">
        <div className="stack">
          <StagePanel key={stage.id} projectId={projectId} stage={stage} members={memberOptions} editable={editable} isOwner={ctx.role === "owner"} isCurrent={stage.id === progress.currentStageId} />
          <ChecklistPanel key={`c-${stage.id}`} projectId={projectId} stage={stage} members={memberOptions} editable={editable} />
          <EvidencePanel
            key={`e-${stage.id}`}
            projectId={projectId}
            stage={stage}
            editable={editable}
            artifacts={artifacts.filter((a) => a.latest).map((a) => ({ id: a.artifact.id, name: a.artifact.name, path: a.artifact.path, versions: a.versions.map((v) => ({ id: v.id, version: v.version })) }))}
          />
        </div>
        <div className="stack">
          <ReadinessCard projectId={projectId} stage={stage} facts={view.facts} />
          <ApprovalsPanel key={`a-${stage.id}`} projectId={projectId} stage={stage} members={memberOptions} editable={editable} userId={ctx.userId} isOwner={ctx.role === "owner"} />
          <Card title="Stage activity" aside={<span className="muted">Latest {activity.length}</span>}>
            {activity.length === 0 ? (
              <p className="muted">Nothing has been recorded for this stage yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {activity.map((e) => (
                  <li key={e.id} className="checkrow">
                    <div>
                      <strong style={{ fontWeight: 550 }}>{e.summary}</strong>
                      <span>{e.actor ?? "System"} · {formatDateTime(e.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
