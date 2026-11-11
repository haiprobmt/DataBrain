"use client";

import { useState } from "react";
import { ReasonDialog, dayValue, useFormSubmit, useSubmit } from "@/components/lifecycle/shared";
import type { LifecycleStatus } from "@/lib/lifecycle";

interface Option {
  to: LifecycleStatus;
  label: string;
  title: string;
  done: string;
}

const NEXT: Partial<Record<LifecycleStatus, Option[]>> = {
  active: [
    { to: "on_hold", label: "Put on hold", title: "Put the lifecycle on hold", done: "Lifecycle put on hold." },
    { to: "completed", label: "Mark lifecycle completed", title: "Mark the lifecycle completed", done: "Lifecycle marked completed." },
  ],
  on_hold: [{ to: "active", label: "Resume lifecycle", title: "Resume the lifecycle", done: "Lifecycle resumed." }],
  completed: [{ to: "active", label: "Reopen lifecycle", title: "Reopen the lifecycle", done: "Lifecycle set back to active." }],
  archived: [{ to: "active", label: "Restore lifecycle", title: "Restore the lifecycle", done: "Lifecycle restored." }],
};

export function LifecycleControls({ projectId, status, targetEndAt, canComplete }: { projectId: string; status: LifecycleStatus; targetEndAt: string | null; canComplete: boolean }) {
  const submitTo = useSubmit();
  const [asking, setAsking] = useState<Option | null>(null);
  const [target, setTarget] = useState(dayValue(targetEndAt));
  const path = `/api/projects/${projectId}/lifecycle`;
  const date = useFormSubmit(() => submitTo(path, { method: "PATCH", body: { targetEndAt: target || null } }, target ? "Target end date saved." : "Target end date cleared."));
  const options = (NEXT[status] ?? []).filter((o) => o.to !== "completed" || canComplete);
  return (
    <div className="toolbar" style={{ margin: "14px 0 0", alignItems: "flex-end" }}>
      <form onSubmit={date.submit} className="actions" style={{ alignItems: "flex-end" }}>
        <div className="field">
          <label htmlFor="lifecycle-target">Target end date</label>
          <input id="lifecycle-target" type="date" className="input" style={{ width: 170 }} value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <button className="btn" disabled={date.busy || target === dayValue(targetEndAt)}>{date.busy ? "Saving…" : "Save date"}</button>
      </form>
      <div className="actions" style={{ marginLeft: "auto" }}>
        {options.map((o) => (
          <button key={o.to} type="button" className="btn" onClick={() => setAsking(o)}>{o.label}</button>
        ))}
      </div>
      {date.error && <p className="form-error" role="alert" style={{ flexBasis: "100%" }}>{date.error}</p>}
      {status !== "active" && <p className="note warn" style={{ flexBasis: "100%", margin: 0 }}>Stages, checklists, evidence and approvals can only be changed while the lifecycle is active.</p>}
      {asking && (
        <ReasonDialog title={asking.title} label="Note" optional confirmLabel={asking.label} hint="Recorded in the audit log with this change." onClose={() => setAsking(null)} onSubmit={(note) => submitTo(path, { method: "PATCH", body: { status: asking.to, ...(note.trim() ? { note } : {}) } }, asking.done)} />
      )}
    </div>
  );
}
