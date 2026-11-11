"use client";

import { useMemo, useState } from "react";
import { api, FieldError, useAction, useUnsavedWarning } from "@/components/client";
import { Badge, EmptyState, StatusBadge } from "@/components/ui";
import { INTAKE_FIELDS } from "@/lib/intake";
import { tokenLabel } from "@/lib/vocab";

interface Row {
  field: string;
  state: "known" | "unknown" | "not-applicable";
  value: string;
  kind: "fact" | "assumption" | "unknown";
  origin: "user" | "extracted";
  evidence: string | null;
  confidence: number | null;
  tokens: string[];
}

const GROUPS = ["Business", "Data & workloads", "Security & network", "Delivery"] as const;

export function RequirementsEditor({ projectId, status, rows, readOnly }: { projectId: string; status: "none" | "draft" | "approved"; rows: Row[]; readOnly: boolean }) {
  const initial = useMemo(
    () => Object.fromEntries(INTAKE_FIELDS.map((f) => [f.key, rows.find((r) => r.field === f.key) ?? { field: f.key, state: "unknown" as const, value: "", kind: "unknown" as const, origin: "user" as const, evidence: null, confidence: null, tokens: [] }])),
    [rows],
  );
  const [draft, setDraft] = useState<Record<string, Row>>(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    // Server data changed (after extraction or save): show it.
    setSeen(initial);
    setDraft(initial);
  }
  const { run, busy, error, fieldErrors } = useAction();
  const dirty = INTAKE_FIELDS.some((f) => draft[f.key]!.state !== initial[f.key]!.state || draft[f.key]!.value !== initial[f.key]!.value || draft[f.key]!.kind !== initial[f.key]!.kind);
  useUnsavedWarning(dirty);
  const update = (field: string, patch: Partial<Row>) => setDraft((d) => ({ ...d, [field]: { ...d[field]!, ...patch } }));
  const unknown = INTAKE_FIELDS.filter((f) => draft[f.key]!.state === "unknown");
  const save = () => run("save", () => api(`/api/projects/${projectId}/requirements`, { method: "PUT", body: { requirements: INTAKE_FIELDS.map((f) => ({ field: f.key, state: draft[f.key]!.state, value: draft[f.key]!.value, kind: draft[f.key]!.kind })) } }), "Requirements saved. Approve them to run the Finder.");

  if (rows.length === 0 && readOnly) return <EmptyState title="No requirements recorded" />;

  return (
    <div className="stack">
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <p className="sub" style={{ margin: 0, maxWidth: "70ch" }}>
          Mark each field as known, unknown or not applicable. Unknown fields are never treated as a match — they lower the confidence of every recommendation.
        </p>
        <StatusBadge status={status === "approved" ? "approved" : "draft"} label={status === "none" ? "Not started" : status === "approved" ? "Approved" : "Draft — needs approval"} />
      </div>
      {GROUPS.map((group) => (
        <fieldset key={group} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="sectiontitle" style={{ fontSize: 14, marginBottom: 6 }}>{group}</legend>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: "19%" }}>Requirement</th>
                  <th style={{ width: 150 }}>State</th>
                  <th>Value</th>
                  <th style={{ width: "27%" }}>Provenance</th>
                </tr>
              </thead>
              <tbody>
                {INTAKE_FIELDS.filter((f) => f.group === group).map((f) => {
                  const row = draft[f.key]!;
                  const saved = initial[f.key]!;
                  const unchanged = row.value === saved.value && row.state === saved.state;
                  return (
                    <tr key={f.key}>
                      <td><strong>{f.label}</strong></td>
                      <td>
                        <label className="sr-only" htmlFor={`state-${f.key}`}>{f.label} state</label>
                        <select id={`state-${f.key}`} className="select" value={row.state} disabled={readOnly} onChange={(e) => update(f.key, { state: e.target.value as Row["state"], kind: e.target.value === "known" ? "fact" : "unknown" })}>
                          <option value="known">Known</option>
                          <option value="unknown">Unknown</option>
                          <option value="not-applicable">Not applicable</option>
                        </select>
                      </td>
                      <td>
                        {row.state === "known" ? (
                          <div className="field">
                            <label className="sr-only" htmlFor={`value-${f.key}`}>{f.label}</label>
                            <input id={`value-${f.key}`} className="input" value={row.value} placeholder={f.placeholder} disabled={readOnly} aria-invalid={!!fieldErrors[f.key]} onChange={(e) => update(f.key, { value: e.target.value })} />
                            <FieldError errors={fieldErrors[f.key]} />
                            <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input type="checkbox" checked={row.kind === "assumption"} disabled={readOnly} onChange={(e) => update(f.key, { kind: e.target.checked ? "assumption" : "fact" })} /> This is an assumption to confirm
                            </label>
                          </div>
                        ) : row.state === "unknown" ? (
                          <span className="muted">Open question: {f.question}</span>
                        ) : (
                          <span className="muted">Not applicable to this project.</span>
                        )}
                      </td>
                      <td>
                        {row.state === "known" && unchanged && saved.origin === "extracted" ? (
                          <>
                            <Badge tone={saved.kind === "assumption" ? "warn" : "info"}>{saved.kind === "assumption" ? "Extracted — loosely worded" : "Extracted from your text"}</Badge>
                            {saved.evidence && <p className="muted" style={{ margin: "5px 0 0" }}>“{saved.evidence.length > 190 ? `${saved.evidence.slice(0, 190)}…` : saved.evidence}”</p>}
                          </>
                        ) : row.state === "known" ? (
                          <Badge tone={row.kind === "assumption" ? "warn" : "neutral"}>{row.kind === "assumption" ? "Assumption" : "Entered by you"}</Badge>
                        ) : row.state === "unknown" ? (
                          <Badge tone="warn">Unknown</Badge>
                        ) : (
                          <Badge>Not applicable</Badge>
                        )}
                        {row.state === "known" && unchanged && saved.tokens.length > 0 && <p className="muted" style={{ margin: "5px 0 0" }}>Matched as: {saved.tokens.map(tokenLabel).join(", ")}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </fieldset>
      ))}
      {unknown.length > 0 && (
        <div className="note warn">
          <strong>{unknown.length} unknown field{unknown.length === 1 ? "" : "s"}:</strong> {unknown.map((f) => f.label).join(", ")}. You can approve with unknowns; the Finder scores them neutrally and reports reduced confidence.
        </div>
      )}
      {error && <p className="form-error" role="alert">{error.message}</p>}
      {!readOnly && (
        <div className="actions">
          <button type="button" className="btn" disabled={!dirty || !!busy} onClick={save}>{busy === "save" ? "Saving…" : "Save requirements"}</button>
          {dirty && <button type="button" className="btn" disabled={!!busy} onClick={() => setDraft(initial)}>Discard changes</button>}
          <button
            type="button"
            className="btn primary"
            disabled={!!busy || (status === "approved" && !dirty)}
            onClick={async () => {
              if (dirty && !(await save())) return;
              await run("approve", () => api(`/api/projects/${projectId}/requirements/approve`, { body: {} }), "Requirements approved. You can now run the Architecture Finder.");
            }}
          >
            {busy === "approve" ? "Approving…" : status === "approved" && !dirty ? "Requirements approved" : dirty ? "Save and approve" : "Approve requirements"}
          </button>
        </div>
      )}
    </div>
  );
}
