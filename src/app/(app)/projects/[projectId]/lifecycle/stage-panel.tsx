"use client";

import { useState } from "react";
import { AlertOctagon } from "lucide-react";
import { api, FieldError, useAction, useUnsavedWarning } from "@/components/client";
import { MemberSelect, ReasonDialog, dayValue, useFormSubmit, useSubmit, type MemberOption } from "@/components/lifecycle/shared";
import { Badge, StatusBadge } from "@/components/ui";
import { statusLabel } from "@/lib/lifecycle";
import { formatDate } from "@/lib/utils";
import type { StageView } from "@/server/services/lifecycle";

type Ask = "block" | "reopen" | "skip";

const ASK: Record<Ask, { title: string; label: string; hint: string; confirm: string; done: string; danger?: boolean }> = {
  block: { title: "Mark stage blocked", label: "What is blocking this stage?", hint: "Shown on the stage and in Mission Control until the stage is resumed.", confirm: "Mark blocked", done: "Stage marked blocked." },
  reopen: { title: "Reopen stage", label: "Why is this stage being reopened?", hint: "Its approval is voided. Later stages that are under way or completed are held for review and lose their approvals; their checklists and evidence are kept.", confirm: "Reopen stage", done: "Stage reopened.", danger: true },
  skip: { title: "Skip stage", label: "Why is this stage being skipped?", hint: "The stage counts as done for stage order and progress, and is shown as skipped with this reason.", confirm: "Skip stage", done: "Stage skipped.", danger: true },
};

export function StagePanel({ projectId, stage, members, editable, isOwner, isCurrent }: { projectId: string; stage: StageView; members: MemberOption[]; editable: boolean; isOwner: boolean; isCurrent: boolean }) {
  const base = `/api/projects/${projectId}/lifecycle/stages/${stage.id}`;
  const submitTo = useSubmit();
  const { run, busy, error } = useAction();
  const [ask, setAsk] = useState<Ask | null>(null);
  const initial = { ownerId: stage.owner?.id ?? null, reviewerId: stage.reviewer?.id ?? null, dueAt: dayValue(stage.dueAt), notes: stage.notes };
  const [form, setForm] = useState(initial);
  const dirty = form.ownerId !== initial.ownerId || form.reviewerId !== initial.reviewerId || form.dueAt !== initial.dueAt || form.notes !== initial.notes;
  useUnsavedWarning(dirty);
  const details = useFormSubmit(() => submitTo(base, { method: "PATCH", body: { ownerId: form.ownerId, reviewerId: form.reviewerId, dueAt: form.dueAt || null, notes: form.notes } }, "Stage details saved."));
  const canSkip = stage.start.allowed && (isOwner || !stage.isRequired);
  const { status } = stage;

  return (
    <section className="card padding" aria-labelledby="stage-title">
      <div className="pane-head">
        <div style={{ minWidth: 0 }}>
          <p className="muted" style={{ margin: 0 }}>Stage {stage.sortOrder}{isCurrent ? " · current stage" : ""}</p>
          <h2 id="stage-title">{stage.name}</h2>
        </div>
        <div className="actions">
          <StatusBadge status={status} label={statusLabel(status)} />
          <Badge>{stage.isRequired ? "Required" : "Optional"}</Badge>
          {stage.overdue && <Badge tone="err">Overdue</Badge>}
        </div>
      </div>
      {stage.description && <p className="sub" style={{ fontSize: 13, margin: "0 0 14px" }}>{stage.description}</p>}

      {status === "blocked" && (
        <div className="banner blocked" role="alert" style={{ marginBottom: 14 }}>
          <AlertOctagon aria-hidden />
          <div><strong>Blocked.</strong> {stage.blockedReason}</div>
        </div>
      )}
      {status === "skipped" && <p className="note warn" style={{ marginBottom: 14 }}><strong>Skipped.</strong> {stage.skipReason}</p>}
      {status === "pending_approval" && <p className="note" style={{ marginBottom: 14 }}>Waiting for approval. The checklist, the evidence and the reviewer are frozen until the request is decided or withdrawn.</p>}

      {editable ? (
        <form onSubmit={details.submit} className="stack" style={{ gap: 12 }}>
          <div className="form-grid three">
            <MemberSelect label="Stage owner" value={form.ownerId} members={members} onChange={(ownerId) => setForm({ ...form, ownerId })} errors={details.fieldErrors.ownerId} />
            <MemberSelect label="Reviewer" value={form.reviewerId} members={members} decidersOnly disabled={status === "pending_approval"} onChange={(reviewerId) => setForm({ ...form, reviewerId })} errors={details.fieldErrors.reviewerId} none="No reviewer" />
            <div className="field">
              <label htmlFor="stage-due">Due date</label>
              <input id="stage-due" type="date" className="input" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
              {stage.defaultDurationDays && <span className="hint">Template guidance: about {stage.defaultDurationDays} days.</span>}
              <FieldError errors={details.fieldErrors.dueAt} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="stage-notes">Stage notes</label>
            <textarea id="stage-notes" className="textarea" style={{ minHeight: 64 }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {details.error && <p className="form-error" role="alert">{details.error}</p>}
          <div className="actions">
            <button className="btn" disabled={!dirty || details.busy}>{details.busy ? "Saving…" : "Save stage details"}</button>
            {dirty && <button type="button" className="btn" onClick={() => setForm(initial)} disabled={details.busy}>Discard changes</button>}
          </div>
        </form>
      ) : (
        <dl className="kv">
          <dt>Stage owner</dt><dd>{stage.owner?.name ?? "Unassigned"}</dd>
          <dt>Reviewer</dt><dd>{stage.reviewer?.name ?? "No reviewer"}</dd>
          <dt>Due date</dt><dd>{formatDate(stage.dueAt)}</dd>
          {stage.notes && (<><dt>Stage notes</dt><dd style={{ whiteSpace: "pre-wrap" }}>{stage.notes}</dd></>)}
        </dl>
      )}

      <dl className="kv" style={{ marginTop: 14 }}>
        <dt>Started</dt><dd>{formatDate(stage.startAt)}</dd>
        <dt>Completed</dt><dd>{formatDate(stage.completedAt)}</dd>
        {stage.completionNote && (<><dt>Completion note</dt><dd>{stage.completionNote}</dd></>)}
      </dl>

      {editable && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div className="actions">
            {status === "not_started" && stage.start.allowed && (
              <button type="button" className="btn primary" disabled={!!busy} onClick={() => run("start", () => api(`${base}/start`, { body: {} }), `${stage.name} started.`)}>{busy === "start" ? "Starting…" : "Start stage"}</button>
            )}
            {status === "blocked" && stage.start.allowed && (
              <button type="button" className="btn primary" disabled={!!busy} onClick={() => run("start", () => api(`${base}/start`, { body: {} }), `${stage.name} resumed.`)}>{busy === "start" ? "Resuming…" : "Resume stage"}</button>
            )}
            {status === "in_progress" && !stage.requiresApproval && (
              <button type="button" className="btn primary" disabled={!!busy || !stage.readiness.ready} onClick={() => run("complete", () => api(`${base}/complete`, { body: {} }), `${stage.name} completed.`)}>{busy === "complete" ? "Completing…" : "Complete stage"}</button>
            )}
            {status === "in_progress" && <button type="button" className="btn" onClick={() => setAsk("block")}>Mark blocked</button>}
            {(status === "not_started" || status === "in_progress") && canSkip && <button type="button" className="btn" onClick={() => setAsk("skip")}>Skip stage</button>}
            {(status === "completed" || status === "skipped") && <button type="button" className="btn" onClick={() => setAsk("reopen")}>Reopen stage</button>}
          </div>
          {(status === "not_started" || status === "blocked") && !stage.start.allowed && <p className="note warn" style={{ marginTop: 10 }}>This stage cannot {status === "blocked" ? "resume" : "start"} yet. {stage.start.reason}</p>}
          {status === "in_progress" && stage.requiresApproval && <p className="muted" style={{ margin: "10px 0 0" }}>This stage is completed by its approval. Request approval once the gate conditions are met.</p>}
          {status === "in_progress" && !stage.requiresApproval && !stage.readiness.ready && <p className="muted" style={{ margin: "10px 0 0" }}>Complete the gate conditions to finish this stage.</p>}
          {error && <p className="form-error" role="alert" style={{ marginTop: 10 }}>{error.message}</p>}
        </div>
      )}

      {ask && (
        <ReasonDialog title={`${ASK[ask].title}: ${stage.name}`} label={ASK[ask].label} hint={ASK[ask].hint} confirmLabel={ASK[ask].confirm} danger={ASK[ask].danger} onClose={() => setAsk(null)} onSubmit={(reason) => submitTo(`${base}/${ask}`, { body: { reason } }, ASK[ask].done)} />
      )}
    </section>
  );
}
