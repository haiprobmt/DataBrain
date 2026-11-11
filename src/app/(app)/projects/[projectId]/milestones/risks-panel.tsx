"use client";

import { useState } from "react";
import { api, Dialog, FieldError, useAction } from "@/components/client";
import { DialogActions, MemberSelect, dayValue, useFormSubmit, useSubmit, type MemberOption } from "@/components/lifecycle/shared";
import { Badge, EmptyState, StatusBadge } from "@/components/ui";
import { RISK_CATEGORIES, RISK_STATUSES, isRiskOpen, riskLevel, statusLabel, type RiskCategory, type RiskStatus } from "@/lib/lifecycle";
import { formatDate } from "@/lib/utils";
import type { RiskView } from "@/server/services/lifecycle";

type Filter = "open" | "all" | "high" | "decided";
const SCALE = [1, 2, 3, 4, 5];
const LIKELIHOOD = ["Rare", "Unlikely", "Possible", "Likely", "Almost certain"];
const IMPACT = ["Minor", "Limited", "Moderate", "Major", "Severe"];

export function RisksPanel({ projectId, risks, members, editable }: { projectId: string; risks: RiskView[]; members: MemberOption[]; editable: boolean }) {
  const base = `/api/projects/${projectId}/risks`;
  const { run, busy, error } = useAction();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<RiskView | "new" | null>(null);
  const shown = risks.filter((r) => (filter === "all" ? true : filter === "open" ? isRiskOpen(r.status) : filter === "high" ? isRiskOpen(r.status) && r.score >= 10 : !isRiskOpen(r.status)));
  const open = risks.filter((r) => isRiskOpen(r.status));
  const setStatus = (r: RiskView, status: RiskStatus, message: string) => run(r.id, () => api(`${base}/${r.id}`, { method: "PATCH", body: { status } }), message);

  return (
    <section className="card padding" id="risks" aria-labelledby="risks-title">
      <div className="pane-head">
        <div>
          <h2 id="risks-title">Risk register</h2>
          <p className="sub">{open.length} open · {open.filter((r) => r.score >= 10).length} high or critical</p>
        </div>
        <div className="actions">
          <label className="sr-only" htmlFor="risk-filter">Show risks</label>
          <select id="risk-filter" className="select mini" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">All risks</option>
            <option value="open">Open and mitigating</option>
            <option value="high">Open, high or critical</option>
            <option value="decided">Accepted, resolved and closed</option>
          </select>
          {editable && <button type="button" className="btn primary" onClick={() => setEditing("new")}>Add risk</button>}
        </div>
      </div>
      {risks.length === 0 ? (
        <EmptyState title="No risks recorded">Record what could stop the project meeting its dates or goals, who owns it and how it is being mitigated.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Score</th><th>Risk</th><th>Category</th><th>Status</th><th>Owner</th><th>Review by</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={7} className="muted">No risk matches this filter.</td></tr>}
              {shown.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span className={`score ${r.level}`}>{r.score}</span> <span className="muted">{statusLabel(r.level)}</span>
                    <div className="muted">L{r.likelihood} × I{r.impact}</div>
                  </td>
                  <td style={{ minWidth: 220 }}>
                    <strong>{r.title}</strong>
                    {r.description && <div className="muted">{r.description}</div>}
                    {r.mitigation && <div className="muted"><b>Mitigation:</b> {r.mitigation}</div>}
                  </td>
                  <td>{statusLabel(r.category)}</td>
                  <td><StatusBadge status={r.status} label={statusLabel(r.status)} /></td>
                  <td>{r.owner?.name ?? <span className="muted">Unassigned</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatDate(r.dueAt)} {r.overdue && <Badge tone="err">Overdue</Badge>}{r.resolvedAt && <div className="muted">Closed out {formatDate(r.resolvedAt)}</div>}</td>
                  <td>
                    {editable && (
                      <div className="actions" style={{ flexWrap: "nowrap" }}>
                        {isRiskOpen(r.status) && <button type="button" className="btn mini" disabled={!!busy} onClick={() => setStatus(r, "resolved", "Risk resolved.")} aria-label={`Resolve ${r.title}`}>Resolve</button>}
                        <button type="button" className="btn mini" onClick={() => setEditing(r)} aria-label={`Edit ${r.title}`}>Edit</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ marginTop: 10 }}>Score = likelihood × impact, each on a 1–5 scale, worked out by the server: 1–4 low, 5–9 medium, 10–15 high, 16–25 critical. It ranks the register; it is not a probability or a forecast.</p>
      {error && <p className="form-error" role="alert" style={{ marginTop: 10 }}>{error.message}</p>}
      {editing && <RiskForm base={base} risk={editing === "new" ? null : editing} members={members} onClose={() => setEditing(null)} />}
    </section>
  );
}

function RiskForm({ base, risk, members, onClose }: { base: string; risk: RiskView | null; members: MemberOption[]; onClose: () => void }) {
  const submitTo = useSubmit();
  const [form, setForm] = useState({
    title: risk?.title ?? "",
    description: risk?.description ?? "",
    category: (risk?.category ?? "delivery") as RiskCategory,
    likelihood: risk?.likelihood ?? 3,
    impact: risk?.impact ?? 3,
    status: (risk?.status ?? "open") as RiskStatus,
    ownerId: risk?.owner?.id ?? null,
    mitigation: risk?.mitigation ?? "",
    dueAt: dayValue(risk?.dueAt),
  });
  const body = { ...form, dueAt: form.dueAt || null };
  const { busy, error, fieldErrors, submit } = useFormSubmit(() => (risk ? submitTo(`${base}/${risk.id}`, { method: "PATCH", body }, "Risk saved.") : submitTo(base, { body }, "Risk added.")), onClose);
  const preview = form.likelihood * form.impact;
  return (
    <Dialog title={risk ? "Edit risk" : "Add risk"} onClose={onClose}>
      <form onSubmit={submit} noValidate className="stack" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="risk-title">Risk</label>
          <input id="risk-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-invalid={!!fieldErrors.title} />
          <FieldError errors={fieldErrors.title} />
        </div>
        <div className="field">
          <label htmlFor="risk-description">Description <span className="muted">(optional)</span></label>
          <textarea id="risk-description" className="textarea" style={{ minHeight: 60 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="risk-category">Category</label>
            <select id="risk-category" className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as RiskCategory })}>
              {RISK_CATEGORIES.map((c) => <option key={c} value={c}>{statusLabel(c)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="risk-status">Status</label>
            <select id="risk-status" className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as RiskStatus })}>
              {RISK_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="risk-likelihood">Likelihood</label>
            <select id="risk-likelihood" className="select" value={form.likelihood} onChange={(e) => setForm({ ...form, likelihood: Number(e.target.value) })}>
              {SCALE.map((n) => <option key={n} value={n}>{n} — {LIKELIHOOD[n - 1]}</option>)}
            </select>
            <FieldError errors={fieldErrors.likelihood} />
          </div>
          <div className="field">
            <label htmlFor="risk-impact">Impact</label>
            <select id="risk-impact" className="select" value={form.impact} onChange={(e) => setForm({ ...form, impact: Number(e.target.value) })}>
              {SCALE.map((n) => <option key={n} value={n}>{n} — {IMPACT[n - 1]}</option>)}
            </select>
            <FieldError errors={fieldErrors.impact} />
          </div>
        </div>
        <p className="muted" style={{ margin: 0 }}>Score {preview} ({riskLevel(preview)}). The stored score is always recalculated by the server from likelihood and impact.</p>
        <div className="field">
          <label htmlFor="risk-mitigation">Mitigation</label>
          <textarea id="risk-mitigation" className="textarea" style={{ minHeight: 60 }} value={form.mitigation} onChange={(e) => setForm({ ...form, mitigation: e.target.value })} />
        </div>
        <div className="form-grid">
          <MemberSelect label="Owner" value={form.ownerId} members={members} onChange={(ownerId) => setForm({ ...form, ownerId })} errors={fieldErrors.ownerId} />
          <div className="field">
            <label htmlFor="risk-due">Review by</label>
            <input id="risk-due" type="date" className="input" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} aria-invalid={!!fieldErrors.dueAt} />
            <FieldError errors={fieldErrors.dueAt} />
          </div>
        </div>
        {error && !Object.keys(fieldErrors).length && <p className="form-error" role="alert">{error}</p>}
        <DialogActions busy={busy} label={risk ? "Save risk" : "Add risk"} onClose={onClose} />
      </form>
    </Dialog>
  );
}
