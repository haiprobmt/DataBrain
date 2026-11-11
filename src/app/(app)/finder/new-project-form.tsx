"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError, errorMessage, FieldError, useUnsavedWarning } from "@/components/client";

export function NewProjectForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", description: "", context: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const dirty = Object.values(form).some((v) => v.trim() !== "");
  useUnsavedWarning(dirty && !busy);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: event.target.value });

  return (
    <form
      className="stack"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setFieldErrors({});
        try {
          const { id } = await api<{ id: string }>("/api/projects", { body: form });
          router.push(`/projects/${id}`);
        } catch (e) {
          setError(errorMessage(e));
          if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="project-name">Project name</label>
        <input id="project-name" className="input" value={form.name} onChange={set("name")} aria-invalid={!!fieldErrors.name} required />
        <FieldError errors={fieldErrors.name} />
      </div>
      <div className="field">
        <label htmlFor="project-description">One-line description <span className="muted">(optional)</span></label>
        <input id="project-description" className="input" value={form.description} onChange={set("description")} />
        <FieldError errors={fieldErrors.description} />
      </div>
      <div className="field">
        <label htmlFor="project-context">Project context</label>
        <textarea id="project-context" className="textarea" style={{ minHeight: 190 }} value={form.context} onChange={set("context")} placeholder="Describe the business objective, source systems, target platform, data volume, freshness, users, workloads, compliance, identity, network, team skills, budget and timeline — in your own words." />
        <span className="hint">Requirements are extracted only from what you write here. Anything you leave out is listed as unknown, never guessed.</span>
        <FieldError errors={fieldErrors.context} />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create project"}</button>
        {dirty && (
          <button type="button" className="btn" onClick={() => setForm({ name: "", description: "", context: "" })} disabled={busy}>
            Clear
          </button>
        )}
      </div>
    </form>
  );
}
