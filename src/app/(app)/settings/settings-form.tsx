"use client";

import { useState } from "react";
import { api, ActionButton, FieldError, useAction, useUnsavedWarning } from "@/components/client";
import { DEFAULT_WEIGHTS, FACTOR_LABELS } from "@/lib/catalog";
import { FACTOR_KEYS, type FinderWeights } from "@/lib/types";

interface Value { workspaceName: string; freshnessPolicyDays: number; defaultWeights: FinderWeights }

export function SettingsForm({ initial, readOnly }: { initial: Value; readOnly: boolean }) {
  const [form, setForm] = useState(initial);
  const { run, busy, error, fieldErrors } = useAction();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useUnsavedWarning(dirty);
  return (
    <form className="stack" noValidate onSubmit={(event) => { event.preventDefault(); void run("save", () => api("/api/settings", { method: "PUT", body: form }), "Settings saved."); }}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ws-name">Workspace name</label>
          <input id="ws-name" className="input" value={form.workspaceName} disabled={readOnly} onChange={(e) => setForm({ ...form, workspaceName: e.target.value })} />
          <FieldError errors={fieldErrors.workspaceName} />
        </div>
        <div className="field">
          <label htmlFor="ws-fresh">Knowledge goes stale after (days)</label>
          <input id="ws-fresh" className="input" type="number" min={7} max={3650} value={form.freshnessPolicyDays} disabled={readOnly} onChange={(e) => setForm({ ...form, freshnessPolicyDays: Number(e.target.value) })} />
          <span className="hint">Reviewed or verified items older than this are flagged stale.</span>
          <FieldError errors={fieldErrors.freshnessPolicyDays} />
        </div>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field"><span className="label">Default Finder weights for new projects</span></legend>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", marginTop: 6 }}>
          {FACTOR_KEYS.map((key) => (
            <div className="field" key={key}>
              <label htmlFor={`dw-${key}`}>{FACTOR_LABELS[key].label}</label>
              <input id={`dw-${key}`} className="input" type="number" min={0} max={100} step={5} value={form.defaultWeights[key]} disabled={readOnly} onChange={(e) => setForm({ ...form, defaultWeights: { ...form.defaultWeights, [key]: Number(e.target.value) } })} />
            </div>
          ))}
        </div>
        <FieldError errors={fieldErrors.defaultWeights} />
      </fieldset>
      {error && <p className="form-error" role="alert">{error.message}</p>}
      {readOnly ? <p className="muted">Only a workspace owner can change settings.</p> : (
        <div className="actions">
          <button className="btn primary" disabled={!dirty || !!busy}>{busy ? "Saving…" : "Save settings"}</button>
          {dirty && <button type="button" className="btn" onClick={() => setForm(initial)}>Discard changes</button>}
          <button type="button" className="btn" onClick={() => setForm({ ...form, defaultWeights: DEFAULT_WEIGHTS })}>Reset weights</button>
        </div>
      )}
    </form>
  );
}

export function VerifySourceButton({ id }: { id: string }) {
  return <ActionButton className="btn mini" label="Record check" busyLabel="Recording…" path={`/api/sources/${id}/verify`} success="Source check recorded." />;
}
