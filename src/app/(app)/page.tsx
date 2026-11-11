import Link from "next/link";
import { AlertOctagon, BookOpen, Boxes, CalendarClock, CheckCircle2, ChevronRight, FolderKanban, Share2, ShieldAlert, Sparkles, Stamp, Upload, Workflow } from "lucide-react";
import { Badge, Card, DemoTag, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { LIFECYCLE_NOT_STARTED_LABEL, statusLabel } from "@/lib/lifecycle";
import { formatDate, formatDateTime } from "@/lib/utils";
import { requireCtx } from "@/server/auth";
import { knowledgeStats } from "@/server/services/knowledge";
import { getLifecyclePortfolioStats, getPortfolio } from "@/server/services/lifecycle";
import { listProjects } from "@/server/services/projects";
import { projectStats, recentActivity } from "@/server/services/workspace";

export const metadata = { title: "Mission Control" };

export default async function MissionControl() {
  const ctx = await requireCtx();
  const [projects, pStats, kStats, activity, lifecycle, portfolio, lifecycleActivity] = await Promise.all([
    listProjects(ctx),
    projectStats(ctx),
    knowledgeStats(ctx),
    recentActivity(ctx, { limit: 10 }),
    getLifecyclePortfolioStats(ctx),
    getPortfolio(ctx),
    recentActivity(ctx, { limit: 8, actionPrefix: "lifecycle." }),
  ]);
  const position = new Map(portfolio.rows.map((r) => [r.project.id, r.lifecycle]));
  const kpis = [
    { label: "Active projects", value: pStats.active, href: "/projects", icon: FolderKanban, tone: "" },
    { label: "Approved blueprints", value: pStats.approved, href: "/studio/blueprint", icon: Boxes, tone: "green" },
    { label: "Knowledge items", value: kStats.total, href: "/knowledge", icon: BookOpen, tone: "blue" },
    { label: "Verified items", value: kStats.verified, href: "/knowledge?status=verified", icon: CheckCircle2, tone: "green" },
  ];
  // Counted from stored lifecycle, milestone, risk and approval rows on every request.
  const lifecycleKpis = [
    { label: "Active lifecycles", value: lifecycle.activeLifecycles, href: "/projects?status=active", icon: Workflow, tone: "" },
    { label: "Projects blocked", value: lifecycle.blockedProjects, href: "/projects?status=active", icon: AlertOctagon, tone: lifecycle.blockedProjects ? "red" : "green" },
    { label: "Overdue milestones", value: lifecycle.overdueMilestones, href: "/projects?sort=due", icon: CalendarClock, tone: lifecycle.overdueMilestones ? "red" : "green" },
    { label: "Open high or critical risks", value: lifecycle.highRisks, href: "/projects?sort=risk", icon: ShieldAlert, tone: lifecycle.highRisks ? "red" : "green" },
    { label: "Pending stage approvals", value: lifecycle.pendingApprovals, href: "/projects?status=active", icon: Stamp, tone: "blue" },
  ];
  const stageTotal = lifecycle.byStage.reduce((n, s) => n + s.count, 0);
  return (
    <>
      <PageHeader title="Mission Control" description={`${ctx.workspaceName} — from project requirements to an approved, traceable solution package.`} />
      <div className="kpis">
        {kpis.map((kpi) => (
          <Link key={kpi.label} href={kpi.href} className="card kpi">
            <span className={`bubble ${kpi.tone}`}><kpi.icon aria-hidden /></span>
            <span><span className="label">{kpi.label}</span><strong>{kpi.value}</strong></span>
          </Link>
        ))}
      </div>
      <section aria-labelledby="delivery-lifecycle-title">
        <h2 id="delivery-lifecycle-title" className="sectiontitle" style={{ margin: "4px 0 10px" }}><Workflow aria-hidden />Delivery lifecycle</h2>
        <div className="kpis five">
          {lifecycleKpis.map((kpi) => (
            <Link key={kpi.label} href={kpi.href} className="card kpi">
              <span className={`bubble ${kpi.tone}`}><kpi.icon aria-hidden /></span>
              <span><span className="label">{kpi.label}</span><strong>{kpi.value}</strong></span>
            </Link>
          ))}
        </div>
      </section>
      <div className="cols">
        <div className="stack">
          <section className="card padding" style={{ borderColor: "#f9dbb4", background: "linear-gradient(180deg, #fffaf3, #fff)" }}>
            <h2 className="sectiontitle"><Sparkles aria-hidden />Architecture Finder</h2>
            <p className="sub" style={{ maxWidth: "75ch", margin: "6px 0 14px", fontSize: 13 }}>
              Describe a project. DataBrain extracts the requirements you stated, lists what is still unknown, and ranks reference architectures with a visible factor breakdown, gaps, trade-offs and sources.
            </p>
            <ol className="steps" style={{ maxWidth: 760, marginBottom: 16 }}>
              {["Requirements", "Candidates", "Blueprint", "Artifacts", "Skills", "Dry-run"].map((step, i) => <li key={step} className="step"><i>{i + 1}</i>{step}</li>)}
            </ol>
            <div className="actions">
              <Link href="/finder" className="btn primary">Start a project</Link>
              <Link href="/scenarios" className="btn">Browse reference scenarios ({kStats.scenarios})</Link>
            </div>
          </section>

          <Card title="Projects" aside={<Link href="/projects" className="muted">All projects</Link>}>
            {projects.length === 0 ? (
              <EmptyState title="No projects yet" action={<Link href="/finder" className="btn primary">Create a project</Link>}>A project holds the requirements, the chosen architecture and everything generated from it.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Project</th><th>Lifecycle stage</th><th>Requirements</th><th>Blueprint</th><th>Updated</th></tr></thead>
                  <tbody>
                    {projects.slice(0, 8).map(({ project, requirementCount, revisionCount, approvedVersion }) => (
                      <tr key={project.id}>
                        <td><Link href={`/projects/${project.id}`}>{project.name}</Link> {project.isDemo && <DemoTag />}</td>
                        <td>{(() => {
                          const at = position.get(project.id);
                          if (!at) return <Badge>{LIFECYCLE_NOT_STARTED_LABEL}</Badge>;
                          return at.currentStage ? <><Link href={`/projects/${project.id}/lifecycle`}>{at.currentStage.name}</Link> <span className="muted">· {at.percent}%</span></> : <StatusBadge status={at.status} label={statusLabel(at.status)} />;
                        })()}</td>
                        <td><StatusBadge status={project.requirementsStatus === "approved" ? "approved" : "draft"} label={project.requirementsStatus === "none" ? "Not started" : `${requirementCount} stated · ${project.requirementsStatus}`} /></td>
                        <td>{approvedVersion ? <StatusBadge status="approved" label={`v${approvedVersion} approved`} /> : revisionCount ? <StatusBadge status="draft" label="Draft" /> : <span className="muted">None</span>}</td>
                        <td>{formatDateTime(project.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Projects needing attention" aside={<span className="muted">Blocked, overdue or waiting for approval</span>}>
            {lifecycle.attention.length === 0 ? (
              <p className="muted">{lifecycle.activeLifecycles === 0 ? "No project has an active lifecycle yet." : "No active project is blocked, overdue or waiting for an approval."}</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Project</th><th>Why</th></tr></thead>
                  <tbody>
                    {lifecycle.attention.map((a) => (
                      <tr key={a.projectId}>
                        <td><Link href={`/projects/${a.projectId}/lifecycle`}>{a.projectName}</Link></td>
                        <td><span className="actions" style={{ gap: 6 }}>{a.reasons.map((r) => <Badge key={r.text} tone={r.kind === "approval" ? "warn" : "err"}>{r.text}</Badge>)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Upcoming milestones" aside={<span className="muted">Open milestones with a date, earliest first</span>}>
            {lifecycle.upcomingMilestones.length === 0 ? (
              <p className="muted">No open milestone has a due date.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Milestone</th><th>Project</th><th>Status</th><th>Due</th></tr></thead>
                  <tbody>
                    {lifecycle.upcomingMilestones.map((m) => (
                      <tr key={m.id}>
                        <td><Link href={`/projects/${m.projectId}/milestones`}>{m.name}</Link></td>
                        <td>{m.projectName}</td>
                        <td><StatusBadge status={m.status} label={statusLabel(m.status)} /></td>
                        <td style={{ whiteSpace: "nowrap" }}>{formatDate(m.dueAt)} {m.overdue && <Badge tone="err">Overdue</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Projects by current stage" aside={<Link href="/projects" className="muted">Portfolio</Link>}>
            {stageTotal === 0 ? (
              <p className="muted">No project has an active lifecycle yet.{lifecycle.notStarted ? ` ${lifecycle.notStarted} active project${lifecycle.notStarted === 1 ? " has" : "s have"} not started one.` : ""}</p>
            ) : (
              <>
                <table className="table">
                  <caption className="sr-only">Number of active lifecycles in each stage</caption>
                  <thead><tr><th>Stage</th><th style={{ textAlign: "right" }}>Projects</th></tr></thead>
                  <tbody>
                    {lifecycle.byStage.map((s) => (
                      <tr key={s.name}><td><Link href={`/projects?stage=${encodeURIComponent(s.name)}`}>{s.name}</Link></td><td style={{ textAlign: "right" }}><strong>{s.count}</strong></td></tr>
                    ))}
                  </tbody>
                </table>
                {lifecycle.notStarted > 0 && <p className="muted" style={{ margin: "8px 0 0" }}><Link href="/projects?status=not_started">{lifecycle.notStarted} active project{lifecycle.notStarted === 1 ? "" : "s"}</Link> without a lifecycle {lifecycle.notStarted === 1 ? "is" : "are"} not counted.</p>}
              </>
            )}
          </Card>
          <Card title="Lifecycle activity">
            {lifecycleActivity.length === 0 ? <p className="muted">No lifecycle changes have been recorded yet.</p> : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {lifecycleActivity.map((e) => (
                  <li key={e.id} className="checkrow"><div><strong style={{ fontWeight: 550 }}>{e.projectId ? <Link href={`/projects/${e.projectId}/lifecycle`}>{e.summary}</Link> : e.summary}</strong><span>{e.actor ?? "System"} · {formatDateTime(e.createdAt)}</span></div></li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Knowledge review">
            <dl className="kv">
              <dt>Drafts to review</dt><dd><Link href="/knowledge?status=draft">{kStats.draft}</Link></dd>
              <dt>Reviewed</dt><dd>{kStats.reviewed}</dd>
              <dt>Verified</dt><dd>{kStats.verified}</dd>
            </dl>
            {kStats.verified === 0 && kStats.total > 0 && <p className="note warn" style={{ marginTop: 10 }}>No item is verified yet, so every recommendation is reported with reduced confidence.</p>}
          </Card>
          <Card title="Quick access">
            <div className="stack" style={{ gap: 8 }}>
              {[
                { href: "/knowledge", icon: BookOpen, title: "Knowledge Library", text: "Search, review and verify knowledge" },
                { href: "/graph", icon: Share2, title: "Knowledge Graph", text: "Explore how items connect" },
                { href: "/knowledge/import", icon: Upload, title: "Import a document", text: "Add Markdown or text to the review queue" },
              ].map((q) => (
                <Link key={q.href} href={q.href} className="task">
                  <span className="bubble blue" style={{ width: 36, height: 36 }}><q.icon aria-hidden style={{ width: 17, height: 17 }} /></span>
                  <div><h3>{q.title}</h3><p>{q.text}</p></div>
                  <ChevronRight className="arrow" aria-hidden />
                </Link>
              ))}
            </div>
          </Card>
          <Card title="Recent activity" aside={<Link href="/settings#audit" className="muted">Audit log</Link>}>
            {activity.length === 0 ? <p className="muted">Nothing has happened in this workspace yet.</p> : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {activity.map((e) => (
                  <li key={e.id} className="checkrow"><div><strong style={{ fontWeight: 550 }}>{e.projectId ? <Link href={`/projects/${e.projectId}`}>{e.summary}</Link> : e.summary}</strong><span>{e.actor ?? "System"} · {formatDateTime(e.createdAt)}</span></div></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
