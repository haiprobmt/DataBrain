import { Card, DemoTag, PageHeader, StatusBadge } from "@/components/ui";
import { DEFAULT_WEIGHTS, sourceTypeLabel } from "@/lib/catalog";
import { formatDate, formatDateTime } from "@/lib/utils";
import { requireCtx } from "@/server/auth";
import { env } from "@/server/env";
import { providerStatus } from "@/server/providers";
import { listSources } from "@/server/services/knowledge";
import { getWorkspace, recentActivity } from "@/server/services/workspace";
import { SettingsForm, VerifySourceButton } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireCtx();
  const [{ workspace, freshnessPolicyDays }, sources, audit] = await Promise.all([getWorkspace(ctx), listSources(ctx), recentActivity(ctx, { limit: 60 })]);
  const providers = providerStatus();
  return (
    <>
      <PageHeader title="Settings & Integrations" description="Workspace settings, the providers behind each capability, the source register and the audit log." />
      <div className="stack">
        <div className="gridtwo">
          <Card title="Workspace">
            <SettingsForm readOnly={ctx.role !== "owner"} initial={{ workspaceName: workspace.name, freshnessPolicyDays, defaultWeights: workspace.settings.defaultWeights ?? DEFAULT_WEIGHTS }} />
          </Card>
          <Card title="Session">
            <dl className="kv">
              <dt>Signed in as</dt><dd>{ctx.userName} ({ctx.userEmail})</dd>
              <dt>Role</dt><dd>{ctx.role}</dd>
              <dt>Workspace</dt><dd>{workspace.name} {workspace.isDemo && <DemoTag />}</dd>
              <dt>Demo mode</dt><dd>{env.demoMode ? "On — visitors without a session use the demo account. Turn it off (DATABRAIN_DEMO_MODE=false) before sharing this deployment." : "Off — sign-in required"}</dd>
            </dl>
          </Card>
        </div>
        <Card title="Providers" aside={<span className="muted">Configured in the server environment. Secrets are never shown here.</span>}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Capability</th><th>Configured</th><th>Active implementation</th><th>Status</th><th>What it does</th></tr></thead>
              <tbody>{providers.map((p) => <tr key={p.kind}><td><strong>{p.kind}</strong></td><td><code>{p.configured}</code></td><td>{p.active ?? "—"}</td><td><StatusBadge status={p.available ? "active" : "failed"} label={p.available ? "Available" : "Not available"} /></td><td>{p.note}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>Only local, deterministic implementations ship today. A provider name that has no implementation is reported as not available — DataBrain never substitutes a local stand-in for a configured real provider.</p>
        </Card>
        <Card title="Source register" aside={<span className="muted">{sources.length} sources</span>}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Source</th><th>Type</th><th>Cited by</th><th>Captured</th><th>Last checked</th><th></th></tr></thead>
              <tbody>
                {sources.length === 0 && <tr><td colSpan={6} className="muted">No sources yet. Add them from a knowledge item.</td></tr>}
                {sources.map(({ source, citations }) => (
                  <tr key={source.id}>
                    <td>{source.url ? <a href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a> : <strong>{source.title}</strong>} {source.isDemo && <DemoTag />}<div className="muted">{source.publisher}</div></td>
                    <td>{sourceTypeLabel(source.sourceType)}</td>
                    <td>{citations} item{citations === 1 ? "" : "s"}</td>
                    <td>{formatDate(source.capturedAt)}</td>
                    <td>{source.lastVerifiedAt ? formatDate(source.lastVerifiedAt) : "Never"}</td>
                    <td>{ctx.role !== "viewer" && <VerifySourceButton id={source.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>Sources cannot be deleted while knowledge cites them. “Record check” notes that you opened the source today and it still says what the citing items rely on.</p>
        </Card>
        <Card title="Audit log" id="audit" aside={<span className="muted">Latest {audit.length} events</span>}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th></tr></thead>
              <tbody>
                {audit.length === 0 && <tr><td colSpan={4} className="muted">No events yet.</td></tr>}
                {audit.map((e) => <tr key={e.id}><td style={{ whiteSpace: "nowrap" }}>{formatDateTime(e.createdAt)}</td><td>{e.actor ?? "System"}</td><td><code>{e.action}</code></td><td>{e.summary}</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
