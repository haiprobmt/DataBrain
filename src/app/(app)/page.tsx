import Link from "next/link";
import { BookOpen, Boxes, CheckCircle2, ChevronRight, FolderKanban, Share2, Sparkles, Upload } from "lucide-react";
import { Card, DemoTag, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { requireCtx } from "@/server/auth";
import { knowledgeStats } from "@/server/services/knowledge";
import { listProjects } from "@/server/services/projects";
import { projectStats, recentActivity } from "@/server/services/workspace";

export const metadata = { title: "Mission Control" };

export default async function MissionControl() {
  const ctx = await requireCtx();
  const [projects, pStats, kStats, activity] = await Promise.all([listProjects(ctx), projectStats(ctx), knowledgeStats(ctx), recentActivity(ctx, { limit: 10 })]);
  const kpis = [
    { label: "Active projects", value: pStats.active, href: "/finder", icon: FolderKanban, tone: "" },
    { label: "Approved blueprints", value: pStats.approved, href: "/studio/blueprint", icon: Boxes, tone: "green" },
    { label: "Knowledge items", value: kStats.total, href: "/knowledge", icon: BookOpen, tone: "blue" },
    { label: "Verified items", value: kStats.verified, href: "/knowledge?status=verified", icon: CheckCircle2, tone: "green" },
  ];
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

          <Card title="Projects" aside={<Link href="/finder" className="muted">All projects</Link>}>
            {projects.length === 0 ? (
              <EmptyState title="No projects yet" action={<Link href="/finder" className="btn primary">Create a project</Link>}>A project holds the requirements, the chosen architecture and everything generated from it.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Project</th><th>Requirements</th><th>Blueprint</th><th>Updated</th></tr></thead>
                  <tbody>
                    {projects.slice(0, 8).map(({ project, requirementCount, revisionCount, approvedVersion }) => (
                      <tr key={project.id}>
                        <td><Link href={`/projects/${project.id}`}>{project.name}</Link> {project.isDemo && <DemoTag />}</td>
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
        </div>

        <div className="stack">
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
