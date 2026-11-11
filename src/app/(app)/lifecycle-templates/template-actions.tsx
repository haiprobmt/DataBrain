"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, FieldError, useAction, useToast } from "@/components/client";
import { useFormSubmit } from "@/components/lifecycle/shared";

export function TemplateActions({ template, isOwner }: { template: { id: string; name: string; isDefault: boolean; isActive: boolean }; isOwner: boolean }) {
  const { run, busy, error } = useAction();
  const base = `/api/lifecycle-templates/${template.id}`;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="actions">
        {isOwner && !template.isDefault && template.isActive && (
          <button type="button" className="btn" disabled={!!busy} onClick={() => run("default", () => api(`${base}/default`, { body: {} }), `“${template.name}” is now the workspace default.`)}>{busy === "default" ? "Saving…" : "Make workspace default"}</button>
        )}
        {!template.isDefault && template.isActive && (
          <button type="button" className="btn" disabled={!!busy} onClick={() => run("active", () => api(base, { method: "PATCH", body: { isActive: false } }), "Template deactivated. It can no longer start new lifecycles.")}>{busy === "active" ? "Saving…" : "Deactivate"}</button>
        )}
        {!template.isActive && (
          <button type="button" className="btn" disabled={!!busy} onClick={() => run("active", () => api(base, { method: "PATCH", body: { isActive: true } }), "Template reactivated.")}>{busy === "active" ? "Saving…" : "Reactivate"}</button>
        )}
      </div>
      {template.isDefault && <p className="muted" style={{ margin: "8px 0 0" }}>The default template cannot be deactivated. Make another template the default first.</p>}
      {error && <p className="form-error" role="alert" style={{ marginTop: 10 }}>{error.message}</p>}
    </div>
  );
}

export function NewTemplateForm({ templates, selectedId }: { templates: { id: string; name: string }[]; selectedId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [fromTemplateId, setFrom] = useState(selectedId);
  const { busy, error, fieldErrors, submit } = useFormSubmit(async () => {
    const created = await api<{ id: string }>("/api/lifecycle-templates", { body: { name, description: "", fromTemplateId } });
    toast("Template created. Edit its stages and save.");
    setName("");
    router.push(`/lifecycle-templates?template=${created.id}`);
    router.refresh();
  });
  return (
    <form onSubmit={submit} noValidate className="stack" style={{ gap: 12 }}>
      <div className="field">
        <label htmlFor="template-name">Name</label>
        <input id="template-name" className="input" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!fieldErrors.name} />
        <FieldError errors={fieldErrors.name} />
      </div>
      <div className="field">
        <label htmlFor="template-source">Copy stages from</label>
        <select id="template-source" className="select" value={fromTemplateId} onChange={(e) => setFrom(e.target.value)}>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="hint">The new template starts as a copy. Change its stages, checklists and gate conditions after creating it.</span>
      </div>
      {error && !fieldErrors.name && <p className="form-error" role="alert">{error}</p>}
      <div className="actions"><button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create template"}</button></div>
    </form>
  );
}
