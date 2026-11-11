"use client";

import { useState } from "react";
import { api, FieldError, useAction } from "@/components/client";
import { Markdown } from "@/components/markdown";
import { EmptyState, StatusBadge } from "@/components/ui";

interface DecisionView {
  id: string;
  number: number;
  title: string;
  status: "proposed" | "accepted" | "superseded" | "rejected";
  context: string;
  decision: string;
  alternatives: string;
  consequences: string;
  revisionId: string | null;
  locked: boolean;
}

const EMPTY = { title: "", status: "proposed" as DecisionView["status"], context: "", decision: "", alternatives: "", consequences: "" };

export function DecisionsPanel({ projectId, revisionId, decisions, readOnly }: { projectId: string; revisionId: string; decisions: DecisionView[]; readOnly: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const { run, busy, error, fieldErrors, setError } = useAction();
  const start = (d: DecisionView | null) => {
    setError(null);
    setEditing(d ? d.id : "new");
    setForm(d ? { title: d.title, status: d.status, context: d.context, decision: d.decision, alternatives: d.alternatives, consequences: d.consequences } : EMPTY);
  };
  const save = async () => {
    const isNew = editing === "new";
    const ok = await run("save", () => api(isNew ? `/api/projects/${projectId}/decisions` : `/api/projects/${projectId}/decisions/${editing}`, { method: isNew ? "POST" : "PUT", body: { ...form, revisionId: isNew ? revisionId : undefined } }), isNew ? "Decision recorded." : "Decision updated.");
    if (ok) setEditing(null);
  };
  const text = (key: "context" | "decision" | "alternatives" | "consequences", label: string) => (
    <div className="field">
      <label htmlFor={`adr-${key}`}>{label}</label>
      <textarea id={`adr-${key}`} className="textarea" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      <FieldError errors={fieldErrors[key]} />
    </div>
  );

  return (
    <div className="stack">
      {decisions.length === 0 && editing === null && <EmptyState title="No decisions recorded">Record why an option was chosen, what was considered and what follows from it.</EmptyState>}
      {decisions.map((d) =>
        editing === d.id ? null : (
          <article key={d.id} className="card padding" style={{ boxShadow: "none" }}>
            <div className="pane-head" style={{ marginBottom: 6 }}>
              <h3>ADR-{d.number}: {d.title}</h3>
              <div className="actions">
                <StatusBadge status={d.status} />
                {!readOnly && !d.locked && <button type="button" className="btn mini" onClick={() => start(d)}>Edit</button>}
              </div>
            </div>
            <dl className="kv">
              <dt>Context</dt><dd><Markdown text={d.context || "—"} /></dd>
              <dt>Decision</dt><dd><Markdown text={d.decision || "—"} /></dd>
              <dt>Alternatives</dt><dd><Markdown text={d.alternatives || "—"} /></dd>
              <dt>Consequences</dt><dd><Markdown text={d.consequences || "—"} /></dd>
            </dl>
            {d.locked && <p className="muted">Accepted and part of an approved revision — record a new decision to supersede it.</p>}
          </article>
        ),
      )}
      {editing !== null ? (
        <div className="card padding" style={{ boxShadow: "none", borderColor: "#f6c791" }}>
          <h3 style={{ marginTop: 0 }}>{editing === "new" ? "New decision record" : "Edit decision record"}</h3>
          <div className="stack" style={{ gap: 12 }}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="adr-title">Title</label>
                <input id="adr-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                <FieldError errors={fieldErrors.title} />
              </div>
              <div className="field">
                <label htmlFor="adr-status">Status</label>
                <select id="adr-status" className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as DecisionView["status"] })}>
                  <option value="proposed">Proposed</option><option value="accepted">Accepted</option><option value="superseded">Superseded</option><option value="rejected">Rejected</option>
                </select>
              </div>
            </div>
            {text("context", "Context")}
            {text("decision", "Decision")}
            {text("alternatives", "Alternatives considered")}
            {text("consequences", "Consequences")}
            {error && <p className="form-error" role="alert">{error.message}</p>}
            <div className="actions">
              <button type="button" className="btn primary" disabled={!!busy} onClick={save}>{busy ? "Saving…" : "Save decision"}</button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : (
        !readOnly && <div><button type="button" className="btn" onClick={() => start(null)}>+ Record a decision</button></div>
      )}
    </div>
  );
}
