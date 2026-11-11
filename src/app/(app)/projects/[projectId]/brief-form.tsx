"use client";

import { useState } from "react";
import { api, FieldError, useAction, useUnsavedWarning } from "@/components/client";

interface Brief {
  id: string;
  name: string;
  description: string;
  context: string;
  status: "active" | "archived";
}

export function BriefForm({ project, hasRequirements, readOnly, extractor }: { project: Brief; hasRequirements: boolean; readOnly: boolean; extractor: { generative: boolean; name: string; error: string | null } }) {
  const [form, setForm] = useState({ name: project.name, description: project.description, context: project.context });
  const [result, setResult] = useState<string | null>(null);
  const { run, busy, error, fieldErrors } = useAction();
  const dirty = form.name !== project.name || form.description !== project.description || form.context !== project.context;
  useUnsavedWarning(dirty);
  const archived = project.status === "archived";
  const locked = readOnly || archived;
  const save = () => run("save", () => api(`/api/projects/${project.id}`, { method: "PUT", body: form }), "Project brief saved.");

  return (
    <div className="stack">
      <div className="form-grid">
        <div className="field">
          <label htmlFor="brief-name">Name</label>
          <input id="brief-name" className="input" value={form.name} disabled={locked} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <FieldError errors={fieldErrors.name} />
        </div>
        <div className="field">
          <label htmlFor="brief-description">Description</label>
          <input id="brief-description" className="input" value={form.description} disabled={locked} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="brief-context">Project context</label>
        <textarea id="brief-context" className="textarea" style={{ minHeight: 150 }} value={form.context} disabled={locked} onChange={(e) => setForm({ ...form, context: e.target.value })} />
        <span className="hint">
          {extractor.error
            ? `Extraction is unavailable: ${extractor.error}`
            : extractor.generative
              ? `Extraction sends this text to ${extractor.name}. Each extracted fact must quote the sentence it came from; facts whose quote is not in your text are discarded. Fields it finds nothing for are listed as unknown.`
              : "Extraction reads only this text, using local vocabulary rules (no generative model is configured). Fields it finds nothing for are listed as unknown."}
        </span>
        <FieldError errors={fieldErrors.context} />
      </div>
      {error && <p className="form-error" role="alert">{error.message}</p>}
      {result && <p className="form-ok" role="status">{result}</p>}
      {!readOnly && (
        <div className="actions">
          {!archived && (
            <>
              <button type="button" className="btn" disabled={!dirty || !!busy} onClick={save}>
                {busy === "save" ? "Saving…" : "Save brief"}
              </button>
              {dirty && (
                <button type="button" className="btn" disabled={!!busy} onClick={() => setForm({ name: project.name, description: project.description, context: project.context })}>
                  Discard changes
                </button>
              )}
              <button
                type="button"
                className="btn primary"
                disabled={!!busy}
                onClick={async () => {
                  setResult(null);
                  if (dirty && !(await save())) return;
                  const r = await run("extract", () => api<{ facts: number; missing: number; provider: string; keptUserFields: string[] }>(`/api/projects/${project.id}/requirements/extract`, { body: {} }));
                  if (r) setResult(`Extracted ${r.facts} requirement(s) with ${r.provider}; ${r.missing} field(s) are unknown.${r.keptUserFields.length ? ` Kept ${r.keptUserFields.length} field(s) you edited.` : ""} Review them below, then approve.`);
                }}
              >
                {busy === "extract" ? "Extracting…" : hasRequirements ? "Re-extract requirements" : "Extract requirements"}
              </button>
            </>
          )}
          <button
            type="button"
            className="btn"
            style={{ marginLeft: "auto" }}
            disabled={!!busy}
            onClick={() => run("status", () => api(`/api/projects/${project.id}`, { method: "PATCH", body: { status: archived ? "active" : "archived" } }), archived ? "Project restored." : "Project archived.")}
          >
            {archived ? "Restore project" : "Archive project"}
          </button>
        </div>
      )}
    </div>
  );
}
