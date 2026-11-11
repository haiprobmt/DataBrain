"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ConfirmDialog, Dialog, errorMessage, FieldError, useAction } from "@/components/client";
import { Badge, EmptyState, StatusBadge } from "@/components/ui";
import type { DeploymentPlanBody, RunLogEntry } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

interface RunRow { id: string; mode: "dry-run" | "execute"; status: string; simulated: boolean; summary: string | null; createdAt: string }
interface ApprovalRow { id: string; status: string; note: string; expiresAt: string; createdAt: string }
interface PlanView { id: string; planHash: string; status: "planned" | "superseded"; createdAt: string; body: DeploymentPlanBody; runs: RunRow[]; approvals: ApprovalRow[] }
interface RunDetail {
  run: { id: string; mode: string; status: string; simulated: boolean; summary: string | null; log: RunLogEntry[]; planHash: string; adapter: string; startedAt: string | null; finishedAt: string | null };
  checks: { id: string; level: string; name: string; status: string; detail: string }[];
  evidence: { id: string; checkId: string | null; actor: string; environment: string; planHash: string; tool: string; command: string; exitCode: number | null; output: string; result: string; simulated: boolean; artifactRefs: string[]; createdAt: string }[];
}
interface Props {
  projectId: string;
  readOnly: boolean;
  canApprove: boolean;
  adapter: { name: string; simulated: boolean; operations: string[]; rollbackLimitations: string[] };
  environments: { id: string; name: string; kind: string; platform: string }[];
  manifests: { id: string; label: string; createdAt: string }[];
  plans: PlanView[];
}

const LEVELS = ["static", "security", "preflight", "deployment", "functional", "operational"];

function RunView({ projectId, runId, onSettled }: { projectId: string; runId: string; onSettled: () => void }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const load = async () => {
      try {
        const d = await api<RunDetail>(`/api/projects/${projectId}/deployments/runs/${runId}`);
        if (cancelled) return;
        setDetail(d);
        if (d.run.status === "queued" || d.run.status === "running") {
          if (Date.now() - started > 120_000) setError("This run is taking longer than expected. Reload the page to check it.");
          else timer = setTimeout(load, 700);
        } else onSettled();
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, runId]);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!detail) return <div className="skeleton" style={{ height: 160 }} aria-busy="true" />;
  const { run, checks, evidence } = detail;
  const active = run.status === "queued" || run.status === "running";
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <div className="pane-head" style={{ marginBottom: 0 }}>
        <h3>{run.mode === "dry-run" ? "Dry-run" : "Execution"} results</h3>
        <div className="actions"><StatusBadge status={run.status} />{run.simulated && <Badge tone="warn" title="The configured adapter never contacts a real platform.">Simulator</Badge>}</div>
      </div>
      {active ? <p className="note" role="status">The run is {run.status}…</p> : <p className={run.status === "failed" ? "form-error" : "note"}>{run.summary}</p>}
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Validation checks</caption>
          <thead><tr><th>Level</th><th>Check</th><th>Result</th><th>Detail</th><th>Evidence</th></tr></thead>
          <tbody>
            {LEVELS.flatMap((level) => checks.filter((c) => c.level === level)).map((c) => {
              const ev = evidence.find((e) => e.checkId === c.id);
              return (
                <tr key={c.id}>
                  <td>{c.level}</td>
                  <td><strong>{c.name}</strong></td>
                  <td><StatusBadge status={c.status} label={c.status === "skipped" ? "Not run" : undefined} /></td>
                  <td>{c.detail}</td>
                  <td>{ev ? <button type="button" className="linkbtn" aria-expanded={showEvidence === ev.id} onClick={() => setShowEvidence(showEvidence === ev.id ? null : ev.id)}>{showEvidence === ev.id ? "Hide" : "View"}</button> : "—"}
                    {ev && showEvidence === ev.id && (
                      <dl className="kv" style={{ marginTop: 8, minWidth: 260 }}>
                        <dt>Recorded</dt><dd>{formatDateTime(ev.createdAt)}</dd>
                        <dt>Actor</dt><dd>{ev.actor}</dd>
                        <dt>Environment</dt><dd>{ev.environment}</dd>
                        <dt>Tool</dt><dd>{ev.tool}</dd>
                        <dt>Command</dt><dd><code>{ev.command}</code></dd>
                        <dt>Exit code</dt><dd>{ev.exitCode === null ? "none (not run)" : ev.exitCode}</dd>
                        <dt>Output</dt><dd><code style={{ whiteSpace: "pre-wrap" }}>{ev.output || "(empty)"}</code></dd>
                        <dt>Plan hash</dt><dd><code>{ev.planHash.slice(0, 16)}…</code></dd>
                        {ev.artifactRefs.length > 0 && <><dt>Files</dt><dd>{ev.artifactRefs.join(", ")}</dd></>}
                        {ev.simulated && <><dt>Simulated</dt><dd>Yes — nothing was changed</dd></>}
                      </dl>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details>
        <summary className="muted" style={{ cursor: "pointer" }}>Run log ({run.log.length} lines)</summary>
        <pre className="code">{run.log.map((l) => `${l.at.slice(11, 19)} ${l.level.toUpperCase().padEnd(5)} ${l.stage ? `[${l.stage}] ` : ""}${l.message}`).join("\n")}</pre>
      </details>
    </div>
  );
}

export function DeploymentStudio({ projectId, readOnly, canApprove, adapter, environments, manifests, plans }: Props) {
  const base = `/api/projects/${projectId}`;
  const { run, busy, error, fieldErrors, setError } = useAction();
  const [env, setEnv] = useState({ name: "", kind: "development", platform: "", notes: "" });
  const [planChoice, setPlanForm] = useState({ environmentId: "", manifestId: "" });
  const planForm = { environmentId: planChoice.environmentId || environments[0]?.id || "", manifestId: planChoice.manifestId || manifests[0]?.id || "" };
  const [now] = useState(() => Date.now());
  const current = plans.filter((p) => p.status === "planned");
  const [openPlan, setOpenPlan] = useState<string | null>(current[0]?.id ?? plans[0]?.id ?? null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [approving, setApproving] = useState<PlanView | null>(null);
  const [approval, setApproval] = useState({ note: "", confirmEnvironment: "", expiresInHours: 8 });
  const [executing, setExecuting] = useState<{ plan: PlanView; approvalId: string } | null>(null);
  const plan = plans.find((p) => p.id === openPlan) ?? null;
  const router = useRouter();

  const startRun = async (p: PlanView, mode: "dry-run" | "execute", approvalId?: string) => {
    const r = await run(`run-${mode}`, () => api<{ id: string }>(`${base}/deployments/plans/${p.id}/runs`, { body: { mode, approvalId } }));
    if (r) setOpenRun(r.id);
  };
  const validApproval = (p: PlanView) => p.approvals.find((a) => a.status === "approved" && new Date(a.expiresAt).getTime() > now);
  const hasDryRun = (p: PlanView) => p.runs.some((r) => r.mode === "dry-run" && r.status === "succeeded");

  return (
    <div className="stack">
      <div className={adapter.simulated ? "note warn" : "note"}>
        <strong>Adapter: {adapter.name}.</strong>{" "}
        {adapter.simulated
          ? "This is a simulator. It runs real read-only checks on the generated files (integrity, syntax, secret scan) and reports every check that needs a real platform as “not run”. It cannot create or change cloud resources, so an approved execution here is a rehearsal of the approval flow, not a deployment."
          : "Runs default to dry-run. Execution needs an approval bound to the exact plan and environment."}
      </div>

      <div className="gridtwo">
        <section className="card padding">
          <div className="pane-head"><h2>Environments</h2></div>
          {environments.length === 0 ? <EmptyState title="No environments">Add the environments this solution will be deployed to. A plan always targets exactly one.</EmptyState> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Kind</th><th>Platform</th></tr></thead><tbody>{environments.map((e) => <tr key={e.id}><td><strong>{e.name}</strong></td><td>{e.kind}</td><td>{e.platform || "—"}</td></tr>)}</tbody></table></div>
          )}
          {!readOnly && (
            <form className="form-grid" style={{ marginTop: 14 }} noValidate onSubmit={async (event) => { event.preventDefault(); const r = await run("env", () => api(`${base}/environments`, { body: env }), "Environment added."); if (r) setEnv({ name: "", kind: "development", platform: "", notes: "" }); }}>
              <div className="field"><label htmlFor="env-name">Name</label><input id="env-name" className="input" value={env.name} onChange={(e) => setEnv({ ...env, name: e.target.value })} placeholder="e.g. dev-eu" /><FieldError errors={busy ? undefined : fieldErrors.name} /></div>
              <div className="field"><label htmlFor="env-kind">Kind</label><select id="env-kind" className="select" value={env.kind} onChange={(e) => setEnv({ ...env, kind: e.target.value })}><option value="development">Development</option><option value="test">Test</option><option value="staging">Staging</option><option value="production">Production</option></select></div>
              <div className="field"><label htmlFor="env-platform">Platform <span className="muted">(optional)</span></label><input id="env-platform" className="input" value={env.platform} onChange={(e) => setEnv({ ...env, platform: e.target.value })} /></div>
              <div className="field" style={{ alignSelf: "end" }}><button className="btn" disabled={!!busy}>{busy === "env" ? "Adding…" : "Add environment"}</button></div>
            </form>
          )}
        </section>

        <section className="card padding">
          <div className="pane-head"><h2>New deployment plan</h2></div>
          {manifests.length === 0 ? <EmptyState title="No package to deploy">Generate artifacts in the Artifact Factory first. A plan deploys one exact generation manifest.</EmptyState> : environments.length === 0 ? <EmptyState title="Add an environment first" /> : (
            <form className="stack" style={{ gap: 12 }} onSubmit={async (event) => { event.preventDefault(); const r = await run("plan", () => api<{ id: string }>(`${base}/deployments/plans`, { body: planForm }), "Plan created. Run a dry-run next."); if (r) { setOpenPlan(r.id); setOpenRun(null); } }}>
              <div className="field"><label htmlFor="plan-env">Target environment</label><select id="plan-env" className="select" value={planForm.environmentId} disabled={readOnly} onChange={(e) => setPlanForm({ ...planForm, environmentId: e.target.value })}>{environments.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.kind})</option>)}</select></div>
              <div className="field"><label htmlFor="plan-manifest">Package (generation manifest)</label><select id="plan-manifest" className="select" value={planForm.manifestId} disabled={readOnly} onChange={(e) => setPlanForm({ ...planForm, manifestId: e.target.value })}>{manifests.map((m) => <option key={m.id} value={m.id}>{m.label} · {formatDateTime(m.createdAt)}</option>)}</select></div>
              {!readOnly && <div><button className="btn primary" disabled={!!busy}>{busy === "plan" ? "Planning…" : "Create plan"}</button></div>}
              <p className="muted">A new plan for an environment replaces the previous one there. Approvals of the old plan stop working.</p>
            </form>
          )}
        </section>
      </div>
      {error && <p className="form-error" role="alert">{error.message}</p>}

      <section className="card padding">
        <div className="pane-head"><h2>Plans</h2></div>
        {plans.length === 0 ? <EmptyState title="No plans yet">Create a plan to see its stages, impact and rollback, then run a dry-run.</EmptyState> : (
          <>
            <div className="actions" style={{ marginBottom: 14 }}>
              {plans.map((p) => (
                <button key={p.id} type="button" className="option" style={{ width: "auto", minWidth: 190 }} aria-pressed={plan?.id === p.id} onClick={() => { setOpenPlan(p.id); setOpenRun(null); }}>
                  <strong>{p.body.environment.name}</strong> <StatusBadge status={p.status} label={p.status === "planned" ? "Current" : "Superseded"} />
                  <div className="muted">{formatDateTime(p.createdAt)} · <code>{p.planHash.slice(0, 10)}</code></div>
                </button>
              ))}
            </div>
            {plan && (
              <div className="stack">
                <div className="form-grid">
                  <dl className="kv">
                    <dt>Environment</dt><dd>{plan.body.environment.name} ({plan.body.environment.kind})</dd>
                    <dt>Plan hash</dt><dd><code>{plan.planHash}</code></dd>
                    <dt>Adapter</dt><dd>{plan.body.adapter.name}{plan.body.adapter.simulated ? " (simulator)" : ""}</dd>
                    <dt>Package</dt><dd><code>{plan.body.manifestHash.slice(0, 16)}…</code></dd>
                  </dl>
                  <dl className="kv">
                    <dt>Estimated impact</dt><dd>{plan.body.impact.summary}</dd>
                    <dt>Cost</dt><dd>{plan.body.impact.costNote}</dd>
                    <dt>Rollback</dt><dd>{plan.body.rollback.join(" ")}</dd>
                    <dt>Prerequisites</dt><dd>{plan.body.prerequisites.join(" ")}</dd>
                  </dl>
                </div>
                <ol className="steps" aria-label="Plan stages">
                  {plan.body.stages.map((s, i) => <li key={s.id} className="step"><i>{i + 1}</i>{s.name}<br /><span>{s.operations.length} operation{s.operations.length === 1 ? "" : "s"}{s.changesTarget ? " · changes target" : ""}</span></li>)}
                </ol>
                <details>
                  <summary className="muted" style={{ cursor: "pointer" }}>Planned operations</summary>
                  <div className="table-wrap"><table className="table"><thead><tr><th>Stage</th><th>Operation</th><th>Change</th></tr></thead><tbody>{plan.body.stages.flatMap((s) => s.operations.map((o) => <tr key={o.id}><td>{s.name}</td><td>{o.description}</td><td>{o.changeType === "none" ? "read-only" : o.changeType}{o.destructive ? " (destructive)" : ""}</td></tr>))}</tbody></table></div>
                </details>

                {plan.status === "superseded" ? <p className="note warn">This plan was replaced by a newer plan for the same environment. It can no longer be run or approved.</p> : !readOnly && (
                  <div className="card padding" style={{ boxShadow: "none" }}>
                    <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Approval gate</h3>
                    <ol className="steps" style={{ maxWidth: 620 }}>
                      <li className={hasDryRun(plan) ? "step done" : "step current"}><i>{hasDryRun(plan) ? "✓" : 1}</i>Dry-run</li>
                      <li className={validApproval(plan) ? "step done" : hasDryRun(plan) ? "step current" : "step"}><i>{validApproval(plan) ? "✓" : 2}</i>Approval</li>
                      <li className={validApproval(plan) ? "step current" : "step"}><i>3</i>Execute</li>
                    </ol>
                    <div className="actions" style={{ marginTop: 10 }}>
                      <button type="button" className="btn primary" disabled={!!busy} onClick={() => startRun(plan, "dry-run")}>{busy === "run-dry-run" ? "Starting…" : "Start dry-run"}</button>
                      {canApprove && <button type="button" className="btn" disabled={!hasDryRun(plan) || !!busy} title={hasDryRun(plan) ? undefined : "Run a successful dry-run first"} onClick={() => { setError(null); setApproval({ note: "", confirmEnvironment: "", expiresInHours: 8 }); setApproving(plan); }}>Approve execution…</button>}
                      <button type="button" className="btn" disabled={!validApproval(plan) || !!busy} title={validApproval(plan) ? undefined : "Needs a valid approval for this plan"} onClick={() => setExecuting({ plan, approvalId: validApproval(plan)!.id })}>Execute…</button>
                    </div>
                    {!canApprove && <p className="muted" style={{ marginTop: 8 }}>Only a workspace owner can approve execution.</p>}
                    {plan.approvals.length > 0 && (
                      <div className="table-wrap" style={{ marginTop: 12 }}>
                        <table className="table"><thead><tr><th>Approval</th><th>Status</th><th>Expires</th><th>Note</th><th></th></tr></thead>
                          <tbody>{plan.approvals.map((a) => {
                            const expired = a.status === "approved" && new Date(a.expiresAt).getTime() <= now;
                            return <tr key={a.id}><td>{formatDateTime(a.createdAt)}</td><td><StatusBadge status={expired ? "revoked" : a.status} label={expired ? "Expired" : a.status === "consumed" ? "Used" : undefined} /></td><td>{formatDateTime(a.expiresAt)}</td><td>{a.note}</td><td>{a.status === "approved" && !expired && <button type="button" className="linkbtn" onClick={() => run("revoke", () => api(`${base}/deployments/approvals/${a.id}`, { method: "DELETE" }), "Approval revoked.")}>Revoke</button>}</td></tr>;
                          })}</tbody></table>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Runs</h3>
                  {plan.runs.length === 0 ? <p className="muted">No runs yet. Start a dry-run to validate the package without changing anything.</p> : (
                    <div className="table-wrap"><table className="table"><thead><tr><th>Started</th><th>Mode</th><th>Status</th><th>Summary</th><th></th></tr></thead><tbody>
                      {plan.runs.map((r) => <tr key={r.id}><td>{formatDateTime(r.createdAt)}</td><td>{r.mode}{r.simulated ? " (simulator)" : ""}</td><td><StatusBadge status={r.status} /></td><td>{r.summary ?? "—"}</td><td><button type="button" className="linkbtn" aria-pressed={openRun === r.id} onClick={() => setOpenRun(openRun === r.id ? null : r.id)}>{openRun === r.id ? "Hide evidence" : "View evidence"}</button></td></tr>)}
                    </tbody></table></div>
                  )}
                </div>
                {openRun && <RunView key={openRun} projectId={projectId} runId={openRun} onSettled={() => router.refresh()} />}
              </div>
            )}
          </>
        )}
      </section>

      {approving && (
        <Dialog title="Approve execution" onClose={() => setApproving(null)}>
          <div className="prose">
            <p>You are approving execution of one exact plan in one environment. The approval is single-use, expires, and stops working if the plan changes.</p>
            <dl className="kv"><dt>Environment</dt><dd>{approving.body.environment.name} ({approving.body.environment.kind})</dd><dt>Plan hash</dt><dd><code>{approving.planHash}</code></dd><dt>Impact</dt><dd>{approving.body.impact.summary}</dd><dt>Rollback</dt><dd>{approving.body.rollback[0]}</dd></dl>
            {approving.body.adapter.simulated && <p className="note warn">The adapter is a simulator: executing this plan will not create anything.</p>}
          </div>
          <div className="stack" style={{ gap: 10, marginTop: 10 }}>
            <div className="field"><label htmlFor="ap-env">Type the environment name to confirm</label><input id="ap-env" className="input" value={approval.confirmEnvironment} onChange={(e) => setApproval({ ...approval, confirmEnvironment: e.target.value })} autoComplete="off" /><FieldError errors={fieldErrors.confirmEnvironment} /></div>
            <div className="field"><label htmlFor="ap-note">What are you approving, and why?</label><textarea id="ap-note" className="textarea" value={approval.note} onChange={(e) => setApproval({ ...approval, note: e.target.value })} /><FieldError errors={fieldErrors.note} /></div>
            <div className="field"><label htmlFor="ap-exp">Valid for</label><select id="ap-exp" className="select" value={approval.expiresInHours} onChange={(e) => setApproval({ ...approval, expiresInHours: Number(e.target.value) })}><option value={1}>1 hour</option><option value={8}>8 hours</option><option value={24}>24 hours</option><option value={72}>72 hours</option></select></div>
            {error && <p className="form-error" role="alert">{error.message}</p>}
          </div>
          <div className="actions" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" className="btn" onClick={() => setApproving(null)}>Cancel</button>
            <button type="button" className="btn primary" disabled={!!busy} onClick={async () => { const r = await run("approve", () => api(`${base}/deployments/plans/${approving.id}/approve`, { body: { planHash: approving.planHash, ...approval } }), "Execution approved."); if (r) setApproving(null); }}>{busy === "approve" ? "Approving…" : "Approve this plan"}</button>
          </div>
        </Dialog>
      )}
      {executing && (
        <ConfirmDialog title={`Execute in ${executing.plan.body.environment.name}?`} confirmLabel={executing.plan.body.adapter.simulated ? "Run simulated execution" : "Execute plan"} onClose={() => setExecuting(null)} onConfirm={() => startRun(executing.plan, "execute", executing.approvalId)}>
          <p>This uses the approval for plan <code>{executing.plan.planHash.slice(0, 12)}</code>. The approval can be used once.</p>
          <p>{executing.plan.body.adapter.simulated ? "The simulator will walk every stage and record evidence, but it creates nothing. Deployment steps are recorded as not run." : executing.plan.body.impact.summary}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
