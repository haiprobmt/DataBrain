"use client";

import { useState } from "react";
import { api, ConfirmDialog, Dialog, FieldError, useAction, useToast } from "@/components/client";
import { DialogActions, MemberSelect, dayValue, useFormSubmit, useSubmit, type MemberOption } from "@/components/lifecycle/shared";
import { Badge, EmptyState, StatusBadge } from "@/components/ui";
import { MILESTONE_STATUSES, isMilestoneOpen, statusLabel, type MilestoneStatus } from "@/lib/lifecycle";
import { formatDate } from "@/lib/utils";
import type { MilestoneView } from "@/server/services/lifecycle";
import { useRouter } from "next/navigation";

type Filter = "open" | "all" | "closed";

export function MilestonesPanel({ projectId, milestones, members, editable }: { projectId: string; milestones: MilestoneView[]; members: MemberOption[]; editable: boolean }) {
  const base = `/api/projects/${projectId}/milestones`;
  const router = useRouter();
  const toast = useToast();
  const { run, busy, error } = useAction();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<MilestoneView | "new" | null>(null);
  const [deleting, setDeleting] = useState<MilestoneView | null>(null);
  const shown = milestones.filter((m) => filter === "all" || (filter === "open") === isMilestoneOpen(m.status));
  const setStatus = (m: MilestoneView, status: MilestoneStatus, message: string) => run(m.id, () => api(`${base}/${m.id}`, { method: "PATCH", body: { status } }), message);

  return (
    <section className="card padding" id="milestones" aria-labelledby="milestones-title">
      <div className="pane-head">
        <h2 id="milestones-title">Milestones</h2>
        <div className="actions">
          <label className="sr-only" htmlFor="milestone-filter">Show milestones</label>
          <select id="milestone-filter" className="select mini" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">All milestones</option>
            <option value="open">Open</option>
            <option value="closed">Completed and cancelled</option>
          </select>
          {editable && <button type="button" className="btn primary" onClick={() => setEditing("new")}>Add milestone</button>}
        </div>
      </div>
      {milestones.length === 0 ? (
        <EmptyState title="No milestones yet">Milestones are dated checkpoints for the project, such as a steering decision, UAT sign-off or go-live. Overdue is worked out from today&apos;s date.</EmptyState>
      ) : (
        <div className="gridtwo" style={{ ["--cols" as string]: "minmax(0, 1.7fr) minmax(220px, 0.8fr)" }}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Milestone</th><th>Status</th><th>Owner</th><th>Due</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={5} className="muted">No milestone matches this filter.</td></tr>}
                {shown.map((m) => (
                  <tr key={m.id}>
                    <td><strong>{m.name}</strong>{m.description && <div className="muted">{m.description}</div>}</td>
                    <td><StatusBadge status={m.status} label={statusLabel(m.status)} /></td>
                    <td>{m.owner?.name ?? <span className="muted">Unassigned</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDate(m.dueAt)} {m.overdue && <Badge tone="err">Overdue</Badge>}{m.completedAt && <div className="muted">Completed {formatDate(m.completedAt)}</div>}</td>
                    <td>
                      {editable && (
                        <div className="actions" style={{ flexWrap: "nowrap" }}>
                          {isMilestoneOpen(m.status) && <button type="button" className="btn mini" disabled={!!busy} onClick={() => setStatus(m, "completed", "Milestone completed.")} aria-label={`Complete ${m.name}`}>Complete</button>}
                          <button type="button" className="btn mini" onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`}>Edit</button>
                          <button type="button" className="btn mini danger" onClick={() => setDeleting(m)} aria-label={`Delete ${m.name}`}>Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Timeline</h3>
            <ol className="timeline" aria-label="Milestone timeline">
              {milestones.map((m) => (
                <li key={m.id} className={m.status === "completed" ? "done" : m.status === "cancelled" ? "off" : m.overdue ? "late" : undefined}>
                  <time>{m.dueAt ? formatDate(m.dueAt) : "No date"}</time>
                  <strong>{m.name}</strong> <span className="muted">· {statusLabel(m.status)}{m.overdue ? " · overdue" : ""}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      {error && <p className="form-error" role="alert" style={{ marginTop: 10 }}>{error.message}</p>}
      {editing && <MilestoneForm base={base} milestone={editing === "new" ? null : editing} members={members} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog title="Delete milestone" confirmLabel="Delete milestone" danger onClose={() => setDeleting(null)} onConfirm={async () => { await api(`${base}/${deleting.id}`, { method: "DELETE", body: {} }); toast("Milestone deleted."); router.refresh(); }}>
          <p>Delete “{deleting.name}”? The deletion is recorded in the audit log. To keep the milestone in the plan, cancel it instead.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function MilestoneForm({ base, milestone, members, onClose }: { base: string; milestone: MilestoneView | null; members: MemberOption[]; onClose: () => void }) {
  const submitTo = useSubmit();
  const [form, setForm] = useState({ name: milestone?.name ?? "", description: milestone?.description ?? "", status: (milestone?.status ?? "planned") as MilestoneStatus, ownerId: milestone?.owner?.id ?? null, dueAt: dayValue(milestone?.dueAt) });
  const body = { ...form, dueAt: form.dueAt || null };
  const { busy, error, fieldErrors, submit } = useFormSubmit(() => (milestone ? submitTo(`${base}/${milestone.id}`, { method: "PATCH", body }, "Milestone saved.") : submitTo(base, { body }, "Milestone added.")), onClose);
  return (
    <Dialog title={milestone ? "Edit milestone" : "Add milestone"} onClose={onClose}>
      <form onSubmit={submit} noValidate className="stack" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="milestone-name">Name</label>
          <input id="milestone-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!fieldErrors.name} />
          <FieldError errors={fieldErrors.name} />
        </div>
        <div className="field">
          <label htmlFor="milestone-description">Description <span className="muted">(optional)</span></label>
          <textarea id="milestone-description" className="textarea" style={{ minHeight: 60 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="milestone-status">Status</label>
            <select id="milestone-status" className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as MilestoneStatus })}>
              {MILESTONE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="milestone-due">Due date</label>
            <input id="milestone-due" type="date" className="input" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} aria-invalid={!!fieldErrors.dueAt} />
            <FieldError errors={fieldErrors.dueAt} />
          </div>
        </div>
        <MemberSelect label="Owner" value={form.ownerId} members={members} onChange={(ownerId) => setForm({ ...form, ownerId })} errors={fieldErrors.ownerId} />
        {error && !Object.keys(fieldErrors).length && <p className="form-error" role="alert">{error}</p>}
        <DialogActions busy={busy} label={milestone ? "Save milestone" : "Add milestone"} onClose={onClose} />
      </form>
    </Dialog>
  );
}
