"use client";

import { useState } from "react";
import { Dialog, FieldError } from "@/components/client";
import { DialogActions, MemberSelect, ReasonDialog, useFormSubmit, useSubmit, type MemberOption } from "@/components/lifecycle/shared";
import { StatusBadge } from "@/components/ui";
import { statusLabel } from "@/lib/lifecycle";
import { formatDateTime } from "@/lib/utils";
import type { ApprovalView, StageView } from "@/server/services/lifecycle";

type Decision = "approve" | "reject" | "withdraw";

const DECISION: Record<Decision, { title: string; label: string; confirm: string; done: string; optional: boolean; hint: string; danger?: boolean }> = {
  approve: { title: "Approve stage gate", label: "Decision note", confirm: "Approve and complete stage", done: "Approved. The stage is completed.", optional: true, hint: "The gate conditions are checked again now. If they hold, the stage is completed." },
  reject: { title: "Reject approval request", label: "What has to change?", confirm: "Reject request", done: "Request rejected. The stage is back in progress.", optional: false, hint: "The stage returns to in progress and the requester sees this note.", danger: true },
  withdraw: { title: "Withdraw approval request", label: "Note", confirm: "Withdraw request", done: "Request withdrawn. The stage is back in progress.", optional: true, hint: "The stage returns to in progress. The request stays in the history as withdrawn." },
};

export function ApprovalsPanel({ projectId, stage, members, editable, userId, isOwner }: { projectId: string; stage: StageView; members: MemberOption[]; editable: boolean; userId: string; isOwner: boolean }) {
  const base = `/api/projects/${projectId}/lifecycle/stages/${stage.id}/approvals`;
  const submitTo = useSubmit();
  const [requesting, setRequesting] = useState(false);
  const [deciding, setDeciding] = useState<{ approval: ApprovalView; decision: Decision } | null>(null);
  const pending = stage.approvals.find((a) => a.status === "requested") ?? null;
  const canDecide = editable && !!pending && (isOwner || pending.reviewer?.id === userId);
  const canWithdraw = editable && !!pending && (isOwner || pending.requestedBy?.id === userId);

  return (
    <section className="card padding" id="approvals" aria-labelledby="approvals-title">
      <div className="pane-head">
        <h2 id="approvals-title">Approval</h2>
        {pending && <StatusBadge status="requested" label="Awaiting decision" />}
      </div>
      {!stage.requiresApproval ? (
        <p className="muted">This stage has no approval gate. It is completed directly once its conditions are met.</p>
      ) : (
        <>
          {editable && stage.status === "in_progress" && (
            <div style={{ marginBottom: 14 }}>
              <button type="button" className="btn primary" disabled={!stage.readiness.ready} aria-describedby="request-hint" onClick={() => setRequesting(true)}>Request approval</button>
              <p id="request-hint" className="muted" style={{ margin: "8px 0 0" }}>
                {stage.readiness.ready ? "Every gate condition is met. The reviewer's approval completes the stage." : "Approval can be requested once every condition under Gate readiness is met."}
              </p>
            </div>
          )}
          {pending && (
            <div className="note" style={{ marginBottom: 14 }}>
              <strong>{pending.requestedBy?.name ?? "A member"}</strong> asked <strong>{pending.reviewer?.name ?? "a reviewer"}</strong> to approve this stage on {formatDateTime(pending.requestedAt)}.
              {pending.requestNote && <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>“{pending.requestNote}”</div>}
              {(canDecide || canWithdraw) && (
                <div className="actions" style={{ marginTop: 10 }}>
                  {canDecide && <button type="button" className="btn primary" onClick={() => setDeciding({ approval: pending, decision: "approve" })}>Approve</button>}
                  {canDecide && <button type="button" className="btn danger" onClick={() => setDeciding({ approval: pending, decision: "reject" })}>Reject</button>}
                  {canWithdraw && <button type="button" className="btn" onClick={() => setDeciding({ approval: pending, decision: "withdraw" })}>Withdraw request</button>}
                </div>
              )}
              {editable && !canDecide && <div style={{ marginTop: 8 }}>Only {pending.reviewer?.name ?? "the reviewer"} or a workspace owner can decide this request.</div>}
            </div>
          )}
        </>
      )}

      <h3 style={{ fontSize: 13, margin: "4px 0 6px" }}>Decision history</h3>
      {stage.approvals.length === 0 ? (
        <p className="muted">No approval has been requested for this stage.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Approval history">
          {stage.approvals.map((a) => (
            <li key={a.id} className="checkrow">
              <div style={{ minWidth: 0 }}>
                <strong>
                  <StatusBadge status={a.invalidated ? "superseded" : a.status} label={a.invalidated ? "Approved — voided" : statusLabel(a.status)} />
                </strong>
                <span style={{ display: "block", marginTop: 4 }}>Requested by {a.requestedBy?.name ?? "—"} · reviewer {a.reviewer?.name ?? "—"} · {formatDateTime(a.requestedAt)}</span>
                {a.requestNote && <span style={{ display: "block", whiteSpace: "pre-wrap" }}>Request: {a.requestNote}</span>}
                {a.decidedAt && <span style={{ display: "block" }}>{statusLabel(a.status)} by {a.decidedBy?.name ?? "—"} · {formatDateTime(a.decidedAt)}</span>}
                {a.decisionNote && <span style={{ display: "block", whiteSpace: "pre-wrap" }}>Decision note: {a.decisionNote}</span>}
                {a.invalidated && <span style={{ display: "block" }}>Voided {formatDateTime(a.invalidated.at)}: {a.invalidated.reason}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {requesting && <RequestApproval base={base} stage={stage} members={members} onClose={() => setRequesting(false)} />}
      {deciding && (
        <ReasonDialog
          title={`${DECISION[deciding.decision].title}: ${stage.name}`}
          label={DECISION[deciding.decision].label}
          hint={DECISION[deciding.decision].hint}
          optional={DECISION[deciding.decision].optional}
          danger={DECISION[deciding.decision].danger}
          confirmLabel={DECISION[deciding.decision].confirm}
          onClose={() => setDeciding(null)}
          onSubmit={(note) => submitTo(`${base}/${deciding.approval.id}/${deciding.decision}`, { body: { note } }, DECISION[deciding.decision].done)}
        />
      )}
    </section>
  );
}

function RequestApproval({ base, stage, members, onClose }: { base: string; stage: StageView; members: MemberOption[]; onClose: () => void }) {
  const submitTo = useSubmit();
  const [reviewerId, setReviewerId] = useState<string | null>(stage.reviewer?.id ?? null);
  const [note, setNote] = useState("");
  const { busy, error, fieldErrors, submit } = useFormSubmit(() => submitTo(base, { body: { note, ...(reviewerId ? { reviewerId } : {}) } }, "Approval requested."), onClose);
  return (
    <Dialog title={`Request approval: ${stage.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="stack" style={{ gap: 12 }}>
        <MemberSelect label="Reviewer" value={reviewerId} members={members} decidersOnly none="Choose a reviewer" onChange={setReviewerId} errors={fieldErrors.reviewerId} />
        <div className="field">
          <label htmlFor="approval-note">What are you asking the reviewer to approve?</label>
          <textarea id="approval-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!fieldErrors.note} />
          <span className="hint">The checklist and evidence are frozen while the request is open. The reviewer, or a workspace owner, decides it.</span>
          <FieldError errors={fieldErrors.note} />
        </div>
        {error && !fieldErrors.note && !fieldErrors.reviewerId && <p className="form-error" role="alert">{error}</p>}
        <DialogActions busy={busy} label="Send request" busyLabel="Sending…" onClose={onClose} />
      </form>
    </Dialog>
  );
}
