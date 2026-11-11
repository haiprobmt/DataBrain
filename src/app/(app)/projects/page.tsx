import Link from "next/link";
import { StartLifecycle } from "@/components/lifecycle/start-lifecycle";
import { Badge, Card, DemoTag, EmptyState, PageHeader, ScoreBar, StatusBadge } from "@/components/ui";
import { LIFECYCLE_NOT_STARTED_LABEL, LIFECYCLE_STATUSES, statusLabel } from "@/lib/lifecycle";
import { formatDate } from "@/lib/utils";
import { requireCtx } from "@/server/auth";
import { getPortfolio, type PortfolioRow } from "@/server/services/lifecycle";
import { listLifecycleTemplates } from "@/server/services/lifecycle-templates";

export const metadata = { title: "Projects" };

const SORTS = { updated: "Recently updated", name: "Name", due: "Next due date", risk: "Open risk" } as const;
type Sort = keyof typeof SORTS;

const sorters: Record<Sort, (a: PortfolioRow, b: PortfolioRow) => number> = {
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  name: (a, b) => a.project.name.localeCompare(b.project.name, "en", { sensitivity: "base" }),
  // Projects without a due date go last.
  due: (a, b) => (a.nextDueAt ?? "9999").localeCompare(b.nextDueAt ?? "9999") || a.project.name.localeCompare(b.project.name),
  risk: (a, b) => b.highRisks - a.highRisks || b.openRisks - a.openRisks || a.project.name.localeCompare(b.project.name),
};

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; stage?: string; archived?: string; sort?: string }> }) {
  const ctx = await requireCtx();
  const query = await searchParams;
  const q = (query.q ?? "").trim();
  const status = LIFECYCLE_STATUSES.find((s) => s === query.status) ?? "";
  const includeArchived = query.archived === "1";
  const sort: Sort = query.sort && query.sort in SORTS ? (query.sort as Sort) : "updated";
  const canEdit = ctx.role !== "viewer";
  const [{ rows }, templates] = await Promise.all([getPortfolio(ctx, { includeArchived }), canEdit ? listLifecycleTemplates(ctx) : Promise.resolve([])]);
  const stageNames = [...new Set(rows.map((r) => r.lifecycle?.currentStage?.name).filter((x): x is string => !!x))];
  const stage = stageNames.find((name) => name === query.stage) ?? "";
  const shown = rows
    .filter((r) => !q || r.project.name.toLowerCase().includes(q.toLowerCase()))
    .filter((r) => !status || (r.lifecycle?.status ?? "not_started") === status)
    .filter((r) => !stage || r.lifecycle?.currentStage?.name === stage)
    .sort(sorters[sort]);
  const filtered = !!(q || status || stage);
  const templateOptions = templates.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault, stageCount: t.stageCount }));

  return (
    <>
      <PageHeader
        title="Projects"
        description="Every project in this workspace with its lifecycle position, next milestone and open risks. All figures are read from stored records when the page loads."
        actions={canEdit ? <Link href="/finder" className="btn primary">Create project</Link> : undefined}
      />
      <Card>
        <form className="filters" action="/projects" role="search" aria-label="Filter projects">
          <div className="field grow">
            <label htmlFor="portfolio-q">Search by name</label>
            <input id="portfolio-q" name="q" type="search" className="input" defaultValue={q} placeholder="Project name" />
          </div>
          <div className="field">
            <label htmlFor="portfolio-status">Lifecycle status</label>
            <select id="portfolio-status" name="status" className="select" defaultValue={status}>
              <option value="">Any status</option>
              {LIFECYCLE_STATUSES.map((s) => <option key={s} value={s}>{s === "not_started" ? LIFECYCLE_NOT_STARTED_LABEL : statusLabel(s)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="portfolio-stage">Current stage</label>
            <select id="portfolio-stage" name="stage" className="select" defaultValue={stage}>
              <option value="">Any stage</option>
              {stageNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="portfolio-sort">Sort by</label>
            <select id="portfolio-sort" name="sort" className="select" defaultValue={sort}>
              {Object.entries(SORTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
          <label className="check"><input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} /> Include archived</label>
          <div className="actions" style={{ paddingBottom: 1 }}>
            <button className="btn">Apply</button>
            {(filtered || includeArchived || sort !== "updated") && <Link href="/projects" className="btn">Reset</Link>}
          </div>
        </form>

        {rows.length === 0 ? (
          <EmptyState title="No projects yet" action={canEdit ? <Link href="/finder" className="btn primary">Create project</Link> : undefined}>
            A project holds its requirements, architecture, generated artifacts and its delivery lifecycle. Create one in the Architecture Finder, then start its lifecycle here.
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState title="No project matches these filters" action={<Link href="/projects" className="btn">Reset filters</Link>}>Change the search or filters to see more projects.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Projects and their lifecycle position</caption>
              <thead>
                <tr><th>Project</th><th>Lifecycle</th><th>Current stage</th><th>Stage completion</th><th>Owner</th><th>Next milestone</th><th>Open risks</th><th>Updated</th></tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const { project, lifecycle } = row;
                  const stageNow = lifecycle?.currentStage;
                  return (
                    <tr key={project.id}>
                      <td style={{ minWidth: 200 }}>
                        <Link href={`/projects/${project.id}`}>{project.name}</Link> {project.isDemo && <DemoTag />} {project.status === "archived" && <StatusBadge status="archived" label="Archived" />}
                        {project.description && <div className="muted">{project.description}</div>}
                      </td>
                      <td>
                        {lifecycle ? <StatusBadge status={lifecycle.status} label={statusLabel(lifecycle.status)} /> : <Badge>{LIFECYCLE_NOT_STARTED_LABEL}</Badge>}
                        {!lifecycle && canEdit && project.status === "active" && <div style={{ marginTop: 6 }}><StartLifecycle compact projectId={project.id} projectName={project.name} templates={templateOptions} /></div>}
                      </td>
                      <td>
                        {!lifecycle ? <span className="muted">—</span> : stageNow ? (
                          <>
                            <Link href={`/projects/${project.id}/lifecycle?stage=${stageNow.stageKey}`}>{stageNow.name}</Link>
                            <div style={{ marginTop: 4 }}><StatusBadge status={stageNow.status} label={statusLabel(stageNow.status)} /></div>
                          </>
                        ) : <span className="muted">All required stages done</span>}
                      </td>
                      <td style={{ minWidth: 130 }}>
                        {lifecycle ? (
                          <>
                            <div className="meter"><ScoreBar value={lifecycle.percent / 100} label={`Stage completion of ${project.name}`} /><b>{lifecycle.percent}%</b></div>
                            <div className="muted">{lifecycle.requiredStagesDone} of {lifecycle.requiredStages} stages</div>
                          </>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td>{project.owner ?? <span className="muted">Unassigned</span>}</td>
                      <td>
                        {row.nextMilestone ? (
                          <>
                            <Link href={`/projects/${project.id}/milestones`}>{row.nextMilestone.name}</Link>
                            <div className="muted">{row.nextMilestone.dueAt ? `Due ${formatDate(row.nextMilestone.dueAt)}` : "No date"}</div>
                          </>
                        ) : <span className="muted">None</span>}
                        {row.overdue && <div style={{ marginTop: 4 }}><Badge tone="err" title={[row.overdueMilestones ? `${row.overdueMilestones} overdue milestone(s)` : "", lifecycle?.overdueStages ? `${lifecycle.overdueStages} overdue stage(s)` : ""].filter(Boolean).join(", ")}>Overdue</Badge></div>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {row.openRisks === 0 ? <span className="muted">None</span> : <Link href={`/projects/${project.id}/milestones#risks`}>{row.openRisks} open</Link>}
                        {row.highRisks > 0 && <div style={{ marginTop: 4 }}><Badge tone="err">{row.highRisks} high</Badge></div>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{formatDate(row.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && <p className="muted" style={{ marginTop: 10 }}>Showing {shown.length} of {rows.length} project{rows.length === 1 ? "" : "s"}. Stage completion counts completed or skipped required stages; it is not a measure of effort, quality or value. A project marked “{LIFECYCLE_NOT_STARTED_LABEL}” has no stage or progress — nothing is inferred from its other records.</p>}
      </Card>
    </>
  );
}
