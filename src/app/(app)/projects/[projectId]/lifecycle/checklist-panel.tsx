"use client";

import { useState } from "react";
import { api, Dialog, FieldError, useAction } from "@/components/client";
import { DialogActions, MemberSelect, ReasonDialog, dayValue, useFormSubmit, useSubmit, type MemberOption } from "@/components/lifecycle/shared";
import { Badge, StatusBadge } from "@/components/ui";
import { CHECKLIST_ITEM_TYPES, statusLabel, type ChecklistItemType } from "@/lib/lifecycle";
import { formatDate } from "@/lib/utils";
import type { ChecklistItemView, StageView } from "@/server/services/lifecycle";

const TYPE_LABEL: Record<ChecklistItemType, string> = { task: "Task", deliverable: "Deliverable", evidence: "Evidence", review: "Review" };

export function ChecklistPanel({ projectId, stage, members, editable }: { projectId: string; stage: StageView; members: MemberOption[]; editable: boolean }) {
  const base = `/api/projects/${projectId}/lifecycle/stages/${stage.id}/checklist`;
  const submitTo = useSubmit();
  const { run, busy, error } = useAction();
  const [editing, setEditing] = useState<ChecklistItemView | null>(null);
  const [waiving, setWaiving] = useState<ChecklistItemView | null>(null);
  const open = stage.status === "not_started" || stage.status === "in_progress" || stage.status === "blocked";
  const canEdit = editable && open;
  const canWork = canEdit && stage.status !== "not_started";
  const required = stage.checklist.filter((i) => i.isRequired);
  const satisfied = required.filter((i) => i.status === "completed" || i.status === "waived").length;

  return (
    <section className="card padding" id="checklist" aria-labelledby="checklist-title">
      <div className="pane-head">
        <h2 id="checklist-title">Readiness checklist</h2>
        <span className="muted">{satisfied} of {required.length} required items done</span>
      </div>
      <p className="sub" style={{ margin: "-6px 0 10px" }}>
        Items are completed by a person: DataBrain does not tick an item because a document exists. Where a gate reads a DataBrain record, that condition is listed under Gate readiness.
        {editable && stage.status === "not_started" && " Start the stage to work through its checklist."}
        {editable && !open && " The checklist is frozen in this stage's current status."}
      </p>
      {stage.checklist.length === 0 && <p className="muted">This stage has no checklist items.</p>}
      <div>
        {stage.checklist.map((item) => (
          <div key={item.id} className="item-row">
            <div style={{ minWidth: 0 }}>
              <div className={item.status === "completed" || item.status === "waived" ? "title done" : "title"}>{item.title}</div>
              {item.description && <div className="muted">{item.description}</div>}
              <div className="line">
                <Badge tone={item.isRequired ? "info" : "neutral"}>{item.isRequired ? "Required" : "Optional"}</Badge>
                <span className="tag">{TYPE_LABEL[item.itemType]}</span>
                {item.origin === "custom" && <span className="tag">Added to this project</span>}
                <span>Assignee: {item.assignee?.name ?? "unassigned"}</span>
                <span>Due: {formatDate(item.dueAt)}</span>
                {item.overdue && <Badge tone="err">Overdue</Badge>}
                {item.evidenceCount > 0 && <a href="#evidence">{item.evidenceCount} evidence</a>}
              </div>
              {item.status === "completed" && <div className="line">Completed by {item.completedBy?.name ?? "—"} on {formatDate(item.completedAt)}</div>}
              {item.status === "waived" && <div className="line"><span><strong>Waived</strong> by {item.statusChangedBy?.name ?? "—"} on {formatDate(item.statusChangedAt)}: {item.waivedReason}</span></div>}
              {item.notes && <div className="line" style={{ whiteSpace: "pre-wrap" }}>Notes: {item.notes}</div>}
            </div>
            <div className="controls">
              {canWork && item.status !== "waived" ? (
                <>
                  <label className="sr-only" htmlFor={`status-${item.id}`}>Status of “{item.title}”</label>
                  <select id={`status-${item.id}`} className="select mini" value={item.status} disabled={!!busy} onChange={(e) => run(item.id, () => api(`${base}/${item.id}`, { method: "PATCH", body: { status: e.target.value } }))}>
                    <option value="pending">Pending</option>
                    <option value="in_progress">In progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </>
              ) : (
                <StatusBadge status={item.status} label={statusLabel(item.status)} />
              )}
              {canWork && item.status === "waived" && <button type="button" className="btn mini" disabled={!!busy} onClick={() => run(item.id, () => api(`${base}/${item.id}`, { method: "PATCH", body: { status: "pending" } }), "Waiver removed; the item is pending again.")}>Remove waiver</button>}
              {canWork && item.status !== "waived" && item.status !== "completed" && <button type="button" className="btn mini" onClick={() => setWaiving(item)} aria-label={`Waive “${item.title}”`}>Waive</button>}
              {canEdit && <button type="button" className="btn mini" onClick={() => setEditing(item)} aria-label={`Edit “${item.title}”`}>Edit</button>}
              {canEdit && item.origin === "custom" && !item.isRequired && (
                <button type="button" className="btn mini danger" disabled={!!busy} onClick={() => run(item.id, () => api(`${base}/${item.id}`, { method: "DELETE", body: {} }), "Checklist item removed.")} aria-label={`Delete “${item.title}”`}>Delete</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="form-error" role="alert" style={{ marginTop: 10 }}>{error.message}</p>}
      {canEdit && <AddItem base={base} />}

      {editing && <EditItem base={base} item={editing} members={members} onClose={() => setEditing(null)} />}
      {waiving && (
        <ReasonDialog title="Waive checklist item" label="Why is this item being waived?" hint={waiving.isRequired ? "This is a required item. The waiver and your reason are recorded in the audit log and stay visible on the checklist." : "The waiver and your reason are recorded in the audit log."} confirmLabel="Waive item" onClose={() => setWaiving(null)} onSubmit={(reason) => submitTo(`${base}/${waiving.id}/waive`, { body: { reason } }, "Item waived.")}>
          <p className="muted" style={{ margin: 0 }}>{waiving.title}</p>
        </ReasonDialog>
      )}
    </section>
  );
}

function AddItem({ base }: { base: string }) {
  const submitTo = useSubmit();
  const empty = { title: "", itemType: "task" as ChecklistItemType, isRequired: false };
  const [form, setForm] = useState(empty);
  const { busy, error, fieldErrors, submit } = useFormSubmit(
    () => submitTo(base, { body: form }, "Checklist item added."),
    () => setForm(empty),
  );
  return (
    <form onSubmit={submit} noValidate style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
      <div className="toolbar" style={{ margin: 0, alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label htmlFor="new-item-title">Add a checklist item</label>
          <input id="new-item-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-invalid={!!fieldErrors.title} placeholder="What has to be done or shown?" />
        </div>
        <div className="field" style={{ flex: "0 1 150px" }}>
          <label htmlFor="new-item-type">Type</label>
          <select id="new-item-type" className="select" value={form.itemType} onChange={(e) => setForm({ ...form, itemType: e.target.value as ChecklistItemType })}>
            {CHECKLIST_ITEM_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <label className="checks" style={{ paddingBottom: 10 }}>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, color: "#435b82" }}>
            <input type="checkbox" checked={form.isRequired} onChange={(e) => setForm({ ...form, isRequired: e.target.checked })} /> Required for the gate
          </span>
        </label>
        <button className="btn" disabled={busy}>{busy ? "Adding…" : "Add item"}</button>
      </div>
      <FieldError errors={fieldErrors.title} />
      {error && !fieldErrors.title && <p className="form-error" role="alert" style={{ marginTop: 8 }}>{error}</p>}
    </form>
  );
}

function EditItem({ base, item, members, onClose }: { base: string; item: ChecklistItemView; members: MemberOption[]; onClose: () => void }) {
  const submitTo = useSubmit();
  const [form, setForm] = useState({ title: item.title, description: item.description, assigneeId: item.assignee?.id ?? null, dueAt: dayValue(item.dueAt), notes: item.notes });
  const { busy, error, fieldErrors, submit } = useFormSubmit(() => submitTo(`${base}/${item.id}`, { method: "PATCH", body: { ...form, dueAt: form.dueAt || null } }, "Checklist item saved."), onClose);
  return (
    <Dialog title="Edit checklist item" onClose={onClose}>
      <form onSubmit={submit} noValidate className="stack" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="item-title">Item</label>
          <input id="item-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-invalid={!!fieldErrors.title} />
          <FieldError errors={fieldErrors.title} />
        </div>
        <div className="field">
          <label htmlFor="item-description">Description <span className="muted">(optional)</span></label>
          <input id="item-description" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="form-grid">
          <MemberSelect label="Assignee" value={form.assigneeId} members={members} onChange={(assigneeId) => setForm({ ...form, assigneeId })} errors={fieldErrors.assigneeId} />
          <div className="field">
            <label htmlFor="item-due">Due date</label>
            <input id="item-due" type="date" className="input" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
            <FieldError errors={fieldErrors.dueAt} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="item-notes">Notes</label>
          <textarea id="item-notes" className="textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <p className="muted" style={{ margin: 0 }}>{item.isRequired ? "Required for the gate." : "Optional."} Whether an item is required is set when it is created and cannot be changed afterwards.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <DialogActions busy={busy} label="Save item" onClose={onClose} />
      </form>
    </Dialog>
  );
}
