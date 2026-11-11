"use client";

import Link from "next/link";
import { useState } from "react";
import { Dialog, FieldError } from "@/components/client";
import { ReasonDialog, useFormSubmit, useSubmit } from "@/components/lifecycle/shared";
import { Badge } from "@/components/ui";
import { evidenceUrlProblem, type EvidenceType } from "@/lib/lifecycle";
import { formatDateTime } from "@/lib/utils";
import type { EvidenceView, StageView } from "@/server/services/lifecycle";

interface ArtifactOption {
  id: string;
  name: string;
  path: string;
  versions: { id: string; version: number }[];
}

const TYPE_LABEL: Record<EvidenceType, string> = { artifact: "DataBrain artifact", url: "Link", note: "Note" };

export function EvidencePanel({ projectId, stage, editable, artifacts }: { projectId: string; stage: StageView; editable: boolean; artifacts: ArtifactOption[] }) {
  const base = `/api/projects/${projectId}/lifecycle/stages/${stage.id}/evidence`;
  const submitTo = useSubmit();
  const [adding, setAdding] = useState(false);
  const [superseding, setSuperseding] = useState<EvidenceView | null>(null);
  const canEdit = editable && (stage.status === "not_started" || stage.status === "in_progress" || stage.status === "blocked");
  const itemTitle = (id: string | null) => stage.checklist.find((i) => i.id === id)?.title;

  return (
    <section className="card padding" id="evidence" aria-labelledby="evidence-title">
      <div className="pane-head">
        <h2 id="evidence-title">Evidence</h2>
        {canEdit && <button type="button" className="btn" onClick={() => setAdding(true)}>Add evidence</button>}
      </div>
      <p className="sub" style={{ margin: "-6px 0 10px" }}>References only: a generated DataBrain artifact, a link, or a note. No file is uploaded or copied. Evidence is never edited or deleted — a wrong reference is marked superseded.</p>
      {stage.evidence.length === 0 ? (
        <p className="muted">No evidence has been recorded for this stage.</p>
      ) : (
        <div>
          {stage.evidence.map((e) => (
            <div key={e.id} className="item-row">
              <div style={{ minWidth: 0 }}>
                <div className={e.superseded ? "title done" : "title"} style={e.superseded ? { textDecoration: "line-through" } : undefined}>{e.title}</div>
                <div className="line">
                  <span className="tag">{TYPE_LABEL[e.evidenceType]}</span>
                  {e.superseded && <Badge tone="warn">Superseded</Badge>}
                  <span>Added by {e.createdBy?.name ?? "—"} · {formatDateTime(e.createdAt)}</span>
                </div>
                {e.artifact && <div className="line"><Link href={`/projects/${projectId}/artifacts`}>{e.artifact.path}</Link>{e.artifact.version ? ` · version ${e.artifact.version}` : ""}</div>}
                {/* Rendered as a link only if it still passes the same check that was applied when it was stored. */}
                {e.url && <div className="line">{evidenceUrlProblem(e.url) === null ? <a href={e.url} target="_blank" rel="noreferrer noopener" style={{ overflowWrap: "anywhere" }}>{e.url}</a> : <span style={{ overflowWrap: "anywhere" }}>{e.url}</span>}</div>}
                {e.note && <div className="line" style={{ whiteSpace: "pre-wrap" }}>{e.note}</div>}
                {e.checklistItemId && <div className="line">For checklist item: {itemTitle(e.checklistItemId) ?? "removed item"}</div>}
                {e.superseded && <div className="line">Superseded by {e.superseded.by?.name ?? "—"} on {formatDateTime(e.superseded.at)}: {e.superseded.reason}</div>}
              </div>
              <div className="controls">
                {canEdit && !e.superseded && <button type="button" className="btn mini" onClick={() => setSuperseding(e)} aria-label={`Mark superseded: ${e.title}`}>Mark superseded</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {adding && <AddEvidence base={base} projectId={projectId} stage={stage} artifacts={artifacts} onClose={() => setAdding(false)} />}
      {superseding && (
        <ReasonDialog title="Mark evidence superseded" label="Why is this reference being superseded?" hint="The record stays in the list, struck through, with your reason. It no longer counts towards the gate." confirmLabel="Mark superseded" onClose={() => setSuperseding(null)} onSubmit={(reason) => submitTo(`${base}/${superseding.id}/supersede`, { body: { reason } }, "Evidence marked superseded.")}>
          <p className="muted" style={{ margin: 0 }}>{superseding.title}</p>
        </ReasonDialog>
      )}
    </section>
  );
}

function AddEvidence({ base, projectId, stage, artifacts, onClose }: { base: string; projectId: string; stage: StageView; artifacts: ArtifactOption[]; onClose: () => void }) {
  const submitTo = useSubmit();
  const [form, setForm] = useState({ evidenceType: "url" as EvidenceType, title: "", url: "", note: "", artifactId: artifacts[0]?.id ?? "", artifactRevisionId: "", checklistItemId: "" });
  const artifact = artifacts.find((a) => a.id === form.artifactId);
  const { busy, error, fieldErrors, submit } = useFormSubmit(
    () =>
      submitTo(
        base,
        {
          body: {
            evidenceType: form.evidenceType,
            title: form.title,
            ...(form.checklistItemId ? { checklistItemId: form.checklistItemId } : {}),
            ...(form.evidenceType === "artifact" ? { artifactId: form.artifactId || undefined, ...(form.artifactRevisionId ? { artifactRevisionId: form.artifactRevisionId } : {}) } : {}),
            ...(form.evidenceType === "url" ? { url: form.url } : {}),
            ...(form.note.trim() ? { note: form.note } : {}),
          },
        },
        "Evidence added.",
      ),
    onClose,
  );
  const noArtifacts = form.evidenceType === "artifact" && artifacts.length === 0;
  return (
    <Dialog title={`Add evidence: ${stage.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="stack" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="evidence-type">Evidence type</label>
          <select id="evidence-type" className="select" value={form.evidenceType} onChange={(e) => setForm({ ...form, evidenceType: e.target.value as EvidenceType })}>
            <option value="url">Link (URL)</option>
            <option value="note">Note</option>
            <option value="artifact">Generated DataBrain artifact</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="evidence-title-input">Title</label>
          <input id="evidence-title-input" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-invalid={!!fieldErrors.title} />
          <FieldError errors={fieldErrors.title} />
        </div>
        {form.evidenceType === "url" && (
          <div className="field">
            <label htmlFor="evidence-url">URL</label>
            <input id="evidence-url" className="input" type="url" inputMode="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" aria-invalid={!!fieldErrors.url} />
            <span className="hint">Only http:// and https:// links are stored. DataBrain keeps the link, not the content behind it.</span>
            <FieldError errors={fieldErrors.url} />
          </div>
        )}
        {form.evidenceType === "artifact" &&
          (noArtifacts ? (
            <p className="note warn">This project has no generated artifacts yet. Generate them in the <Link href={`/projects/${projectId}/artifacts`}>Artifact Factory</Link> first.</p>
          ) : (
            <div className="form-grid">
              <div className="field">
                <label htmlFor="evidence-artifact">Artifact</label>
                <select id="evidence-artifact" className="select" value={form.artifactId} onChange={(e) => setForm({ ...form, artifactId: e.target.value, artifactRevisionId: "" })}>
                  {artifacts.map((a) => <option key={a.id} value={a.id}>{a.path}</option>)}
                </select>
                <FieldError errors={fieldErrors.artifactId} />
              </div>
              <div className="field">
                <label htmlFor="evidence-version">Version</label>
                <select id="evidence-version" className="select" value={form.artifactRevisionId} onChange={(e) => setForm({ ...form, artifactRevisionId: e.target.value })}>
                  <option value="">Latest (v{artifact?.versions[0]?.version ?? "—"})</option>
                  {artifact?.versions.map((v) => <option key={v.id} value={v.id}>Version {v.version}</option>)}
                </select>
              </div>
            </div>
          ))}
        <div className="field">
          <label htmlFor="evidence-note">{form.evidenceType === "note" ? "Note" : <>Comment <span className="muted">(optional)</span></>}</label>
          <textarea id="evidence-note" className="textarea" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-invalid={!!fieldErrors.note} />
          <FieldError errors={fieldErrors.note} />
        </div>
        <div className="field">
          <label htmlFor="evidence-item">Checklist item it supports <span className="muted">(optional)</span></label>
          <select id="evidence-item" className="select" value={form.checklistItemId} onChange={(e) => setForm({ ...form, checklistItemId: e.target.value })}>
            <option value="">The stage as a whole</option>
            {stage.checklist.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
          </select>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="actions" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || noArtifacts}>{busy ? "Adding…" : "Add evidence"}</button>
        </div>
      </form>
    </Dialog>
  );
}
