import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertOctagon, ChevronRight } from "lucide-react";
import { StartLifecycle } from "@/components/lifecycle/start-lifecycle";
import { Badge, Card, ScoreBar, StatusBadge } from "@/components/ui";
import { LIFECYCLE_NOT_STARTED_LABEL, isRiskOpen, statusLabel } from "@/lib/lifecycle";
import { formatDate, formatDateTime } from "@/lib/utils";
import { requireCtx } from "@/server/auth";
import { getProjectLifecycle, listMembers, listMilestones, listRisks } from "@/server/services/lifecycle";
import { listLifecycleTemplates } from "@/server/services/lifecycle-templates";
import { getProject } from "@/server/services/projects";
import { listSkills } from "@/server/services/skills";
import { recentActivity } from "@/server/services/workspace";

export const metadata = { title: "Project overview" };

export default async function ProjectOverviewPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ run?: string }> }) {
  const ctx = await requireCtx();
  const { projectId } = await params;
  // Finder run links used to live on this URL; keep them working.
  const run = (await searchParams).run;
  if (run && /^\d+$/.test(run)) redirect(`/projects/${projectId}/requirements?run=${run}#candidates`);

  const [project, view, milestones, risks, members, skills, activity] = await Promise.all([
    getProject(ctx, projectId),
    getProjectLifecycle(ctx, projectId),
    listMilestones(ctx, projectId),
    listRisks(ctx, projectId),
    listMembers(ctx),
    listSkills(ctx, projectId),
    recentActivity(ctx, { projectId, limit: 8 }),
  ]);
  const base = `/projects/${projectId}`;
  const canEdit = ctx.role !== "viewer" && project.status !== "archived";
  const { lifecycle, progress, stages, facts } = view;
  const current = stages.find((s) => s.id === progress?.currentStageId) ?? null;
  const blocked = stages.filter((s) => s.status === "blocked");
  const overdueStages = stages.filter((s) => s.overdue);
  const pending = stages.filter((s) => s.status === "pending_approval");
  const openMilestones = milestones.filter((m) => m.status !== "completed" && m.status !== "cancelled");
  const nextMilestone = openMilestones[0] ?? null;
  const overdueMilestones = openMilestones.filter((m) => m.overdue);
  const openRisks = risks.filter((r) => isRiskOpen(r.status));
  const highRisks = openRisks.filter((r) => r.score >= 10);
  const templates = !lifecycle && canEdit ? (await listLifecycleTemplates(ctx)).filter((t) => t.isActive) : [];

  const modules = [
    { href: `${base}/requirements`, name: "Requirements & Finder", state: <StatusBadge status={facts.requirementsStatus === "approved" ? "approved" : "draft"} label={facts.requirementsStatus === "none" ? "Not started" : statusLabel(facts.requirementsStatus)} />, detail: facts.requirementsStatus === "approved" ? `Approved ${formatDate(project.requirementsApprovedAt)}` : "Requirements are not approved" },
    { href: `${base}/blueprint`, name: "Solution Blueprint", state: facts.blueprint.approved ? <StatusBadge status="approved" label={`v${facts.blueprint.approvedVersion} approved`} /> : <StatusBadge status="draft" label={facts.blueprint.exists ? "Draft" : "None"} />, detail: facts.blueprint.approved ? "An approved revision exists" : facts.blueprint.exists ? "No revision is approved yet" : "No blueprint has been created" },
    { href: `${base}/artifacts`, name: "Artifact Factory", state: <StatusBadge status={facts.artifactCount ? "active" : "draft"} label={facts.artifactCount ? `${facts.artifactCount} artifacts` : "None"} />, detail: facts.artifactCount ? "Generated from an approved blueprint" : "Nothing generated yet" },
    { href: `${base}/skills`, name: "AI Skill Factory", state: <StatusBadge status={skills.length ? "active" : "draft"} label={skills.length ? `${skills.length} skills` : "None"} />, detail: skills.length ? "Skill definitions generated" : "No skills generated yet" },
    {
      href: `${base}/deployments`,
      name: "Deployment Studio",
      state: facts.deployment.dryRunSucceeded ? <StatusBadge status="passed" label={facts.deployment.simulated ? "Dry-run succeeded (simulated)" : "Dry-run succeeded"} /> : <StatusBadge status="draft" label={facts.deployment.planExists ? "Plan, no dry-run" : "No plan"} />,
      detail: facts.deployment.dryRunSucceeded ? (facts.deployment.simulated ? "Simulator adapter: nothing is deployed" : "Current plan has a successful dry-run") : facts.deployment.planExists ? "The current plan has no successful dry-run" : "No deployment plan yet",
    },
  ];

  return (
    <div className="stack">
      <div className="cols">
        <div className="stack">
          <Card title="Lifecycle" aside={lifecycle ? <StatusBadge status={lifecycle.status} label={statusLabel(lifecycle.status)} /> : <Badge>{LIFECYCLE_NOT_STARTED_LABEL}</Badge>}>
            {!lifecycle || !progress ? (
              <div className="stack" style={{ gap: 12 }}>
                <p className="sub" style={{ fontSize: 13, margin: 0 }}>
                  This project has no lifecycle yet, so no stage, progress or gate is shown for it. Starting one copies a template&apos;s stages and checklists into the project; nothing is marked complete from the existing requirements, blueprint or deployment records.
                </p>
                {canEdit ? <StartLifecycle compact projectId={projectId} projectName={project.name} templates={templates.map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault, stageCount: t.stageCount }))} /> : <p className="muted" style={{ margin: 0 }}>An owner or editor can start the lifecycle.</p>}
              </div>
            ) : (
              <div className="stack" style={{ gap: 14 }}>
                <div>
                  <div className="meter">
                    <ScoreBar value={progress.percent / 100} label="Stage completion" />
                    <b>{progress.percent}%</b>
                  </div>
                  <p className="sub" style={{ marginTop: 6 }}>Stage completion: {progress.requiredStagesDone} of {progress.requiredStages} required stages completed or skipped. Not a measure of effort, quality or value.</p>
                </div>
                <dl className="kv">
                  <dt>Current stage</dt>
                  <dd>{current ? <><Link href={`${base}/lifecycle?stage=${current.stageKey}`}>{current.name}</Link> <StatusBadge status={current.status} label={statusLabel(current.status)} /></> : "All required stages are completed"}</dd>
                  {current && (<><dt>Stage owner</dt><dd>{current.owner?.name ?? "Unassigned"}</dd><dt>Stage due</dt><dd>{formatDate(current.dueAt)} {current.overdue && <Badge tone="err">Overdue</Badge>}</dd></>)}
                  <dt>Started</dt><dd>{formatDate(lifecycle.startedAt)}</dd>
                  <dt>Target end</dt><dd>{formatDate(lifecycle.targetEndAt)}</dd>
                  <dt>Template</dt><dd>{lifecycle.templateName} · v{lifecycle.templateVersion}</dd>
                </dl>
                {blocked.map((s) => (
                  <div key={s.id} className="banner blocked">
                    <AlertOctagon aria-hidden />
                    <div><strong><Link href={`${base}/lifecycle?stage=${s.stageKey}`}>{s.name}</Link> is blocked.</strong> {s.blockedReason}</div>
                  </div>
                ))}
                {(overdueStages.length > 0 || pending.length > 0) && (
                  <p className="note warn" style={{ margin: 0 }}>
                    {overdueStages.length > 0 && <>Overdue: {overdueStages.map((s) => s.name).join(", ")}. </>}
                    {pending.length > 0 && <>Waiting for approval: {pending.map((s) => s.name).join(", ")}.</>}
                  </p>
                )}
                <div className="actions"><Link href={`${base}/lifecycle`} className="btn primary">Open lifecycle</Link></div>
              </div>
            )}
          </Card>

          <Card title="Delivery modules" aside={<span className="muted">Read from each module&apos;s own records</span>}>
            <div className="stack" style={{ gap: 8 }}>
              {modules.map((m) => (
                <Link key={m.href} href={m.href} className="task">
                  <div style={{ minWidth: 0 }}>
                    <h3>{m.name}</h3>
                    <p>{m.detail}</p>
                  </div>
                  <span style={{ marginLeft: "auto" }}>{m.state}</span>
                  <ChevronRight className="arrow" style={{ marginLeft: 0 }} aria-hidden />
                </Link>
              ))}
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title="Project">
            <dl className="kv">
              <dt>Owner</dt><dd>{members.find((m) => m.id === project.ownerId)?.name ?? "Unassigned"}</dd>
              <dt>Status</dt><dd><StatusBadge status={project.status} label={statusLabel(project.status)} /></dd>
              <dt>Description</dt><dd>{project.description || "—"}</dd>
              <dt>Created</dt><dd>{formatDate(project.createdAt)}</dd>
              <dt>Updated</dt><dd>{formatDateTime(project.updatedAt)}</dd>
            </dl>
          </Card>
          <Card title="Milestones" aside={<Link href={`${base}/milestones`} className="muted">All milestones</Link>}>
            {nextMilestone ? (
              <dl className="kv">
                <dt>Next milestone</dt><dd>{nextMilestone.name}</dd>
                <dt>Due</dt><dd>{formatDate(nextMilestone.dueAt)} {nextMilestone.overdue && <Badge tone="err">Overdue</Badge>}</dd>
                <dt>Open</dt><dd>{openMilestones.length}{overdueMilestones.length ? ` · ${overdueMilestones.length} overdue` : ""}</dd>
              </dl>
            ) : (
              <p className="muted">{milestones.length ? "Every milestone is completed or cancelled." : "No milestones have been recorded."}</p>
            )}
          </Card>
          <Card title="Open risks" aside={<Link href={`${base}/milestones#risks`} className="muted">Risk register</Link>}>
            {openRisks.length === 0 ? (
              <p className="muted">{risks.length ? "No risk is open or being mitigated." : "No risks have been recorded."}</p>
            ) : (
              <>
                <p className="sub" style={{ margin: "0 0 8px" }}>{openRisks.length} open · {highRisks.length} high or critical</p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {openRisks.slice(0, 4).map((r) => (
                    <li key={r.id} className="checkrow" style={{ alignItems: "center" }}>
                      <span className={`score ${r.level}`} title={`Likelihood ${r.likelihood} × impact ${r.impact}`}>{r.score}</span>
                      <div style={{ minWidth: 0 }}><strong>{r.title}</strong><span>{statusLabel(r.status)} · {r.owner?.name ?? "no owner"}</span></div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
          <Card title="Recent project activity">
            {activity.length === 0 ? <p className="muted">Nothing has happened in this project yet.</p> : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {activity.map((e) => (
                  <li key={e.id} className="checkrow"><div><strong style={{ fontWeight: 550 }}>{e.summary}</strong><span>{e.actor ?? "System"} · {formatDateTime(e.createdAt)}</span></div></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
