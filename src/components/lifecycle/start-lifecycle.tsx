"use client";

import { useId, useState } from "react";
import { useFormSubmit, useSubmit } from "./shared";

export interface TemplateOption {
  id: string;
  name: string;
  isDefault: boolean;
  stageCount: number;
}

/**
 * Starts a project's lifecycle from a template. With one active template it is a single button; with more it
 * offers the choice first. Nothing is inferred from existing project data: the first stage starts in progress.
 */
export function StartLifecycle({ projectId, projectName, templates, compact }: { projectId: string; projectName: string; templates: TemplateOption[]; compact?: boolean }) {
  const id = useId();
  const submitTo = useSubmit();
  const fallback = templates.find((t) => t.isDefault) ?? templates[0];
  const [templateId, setTemplateId] = useState(fallback?.id ?? "");
  const { busy, error, submit } = useFormSubmit(() => submitTo(`/api/projects/${projectId}/lifecycle`, { body: templateId ? { templateId } : {} }, `Lifecycle started for ${projectName}.`));
  return (
    <form onSubmit={submit} className="actions" style={{ justifyContent: compact ? "flex-start" : "center" }}>
      {templates.length > 1 && (
        <>
          <label className="sr-only" htmlFor={id}>Lifecycle template for {projectName}</label>
          <select id={id} className="select mini" value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={busy}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{t.isDefault ? " (default)" : ""} · {t.stageCount} stages
              </option>
            ))}
          </select>
        </>
      )}
      <button className={compact ? "btn mini" : "btn primary"} disabled={busy} aria-label={compact ? `Start lifecycle for ${projectName}` : undefined}>
        {busy ? "Starting…" : "Start lifecycle"}
      </button>
      {error && <span className="field"><span className="error" role="alert">{error}</span></span>}
    </form>
  );
}
