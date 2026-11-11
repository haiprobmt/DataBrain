"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError, ConfirmDialog, errorMessage, FieldError, useUnsavedWarning } from "@/components/client";
import { ARTICLE_SECTIONS, KNOWLEDGE_TYPES, SOURCE_TYPES } from "@/lib/catalog";
import type { KnowledgeAttributes, KnowledgeSection } from "@/lib/types";
import { VOCAB } from "@/lib/vocab";

export interface ItemFormValue {
  id?: string;
  version?: number;
  status?: string;
  title: string;
  type: string;
  summary: string;
  tags: string[];
  sourceType: string;
  confidence: number | null;
  sections: KnowledgeSection[];
  attributes: KnowledgeAttributes;
}

const TOKEN_FIELDS: { key: "platforms" | "clouds" | "workloads" | "latency" | "sourceSystems" | "security" | "skills"; label: string; groups: (keyof typeof VOCAB)[] }[] = [
  { key: "platforms", label: "Platforms", groups: ["platforms"] },
  { key: "clouds", label: "Clouds", groups: ["clouds"] },
  { key: "workloads", label: "Workloads covered", groups: ["workloads"] },
  { key: "latency", label: "Latency supported", groups: ["latency"] },
  { key: "sourceSystems", label: "Source systems", groups: ["sourceSystems"] },
  { key: "security", label: "Security, network and compliance addressed", groups: ["compliance", "identity", "network", "availability"] },
  { key: "skills", label: "Skills needed", groups: ["skills"] },
];
const LINE_FIELDS: { key: "costDrivers" | "tradeoffs" | "limitations" | "steps"; label: string }[] = [
  { key: "costDrivers", label: "Cost drivers (one per line — qualitative, no prices)" },
  { key: "tradeoffs", label: "Trade-offs (one per line)" },
  { key: "limitations", label: "Limitations (one per line)" },
  { key: "steps", label: "Delivery steps (one per line)" },
];
const MATCHED = ["scenario"];

export function ItemForm({ initial, cancelHref }: { initial: ItemFormValue; cancelHref: string }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [diagram, setDiagram] = useState(initial.attributes.diagram ? JSON.stringify(initial.attributes.diagram, null, 2) : "");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [confirmVerified, setConfirmVerified] = useState(false);
  useUnsavedWarning(dirty && !busy);
  const change = (patch: Partial<ItemFormValue>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const attr = (patch: Partial<KnowledgeAttributes>) => change({ attributes: { ...form.attributes, ...patch } });
  const sectionBody = (key: string) => form.sections.find((s) => s.key === key)?.body ?? "";
  const setSection = (key: string, title: string, body: string) => {
    const others = form.sections.filter((s) => s.key !== key);
    const order = [...ARTICLE_SECTIONS.map((s) => s.key as string), ...form.sections.map((s) => s.key)];
    change({ sections: (body.trim() ? [...others, { key, title, body }] : others).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) });
  };
  const extraSections = form.sections.filter((s) => !ARTICLE_SECTIONS.some((d) => d.key === s.key));
  const scenarioLike = MATCHED.includes(form.type);

  const submit = async (confirmVerifiedEdit = false) => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      let diagramValue: unknown;
      if (diagram.trim()) {
        try {
          diagramValue = JSON.parse(diagram);
        } catch {
          setFieldErrors({ "attributes.diagram": ["The diagram template is not valid JSON."] });
          setError("Fix the highlighted fields.");
          setBusy(false);
          return;
        }
      }
      const attributes = { ...form.attributes, diagram: diagramValue } as Record<string, unknown>;
      for (const key of Object.keys(attributes)) if (attributes[key] === undefined || attributes[key] === "" || (Array.isArray(attributes[key]) && (attributes[key] as unknown[]).length === 0)) delete attributes[key];
      const body = { title: form.title, type: form.type, summary: form.summary, sections: form.sections, attributes, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), sourceType: form.sourceType, confidence: form.confidence };
      const result = form.id ? await api<{ slug: string }>(`/api/knowledge/${form.id}`, { method: "PUT", body: { ...body, expectedVersion: form.version, confirmVerifiedEdit } }) : await api<{ slug: string }>("/api/knowledge", { body });
      setDirty(false);
      router.push(`/knowledge/${result.slug}`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.details.requiresConfirmation === "confirmVerifiedEdit") {
        setConfirmVerified(true);
      } else {
        setError(errorMessage(e));
        if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
      }
      setBusy(false);
    }
  };

  return (
    <form className="stack" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <section className="card padding stack">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="k-title">Title</label>
            <input id="k-title" className="input" value={form.title} onChange={(e) => change({ title: e.target.value })} aria-invalid={!!fieldErrors.title} />
            <FieldError errors={fieldErrors.title} />
          </div>
          <div className="field">
            <label htmlFor="k-type">Type</label>
            <select id="k-type" className="select" value={form.type} onChange={(e) => change({ type: e.target.value })}>
              {KNOWLEDGE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="k-summary">Summary</label>
          <textarea id="k-summary" className="textarea" value={form.summary} onChange={(e) => change({ summary: e.target.value })} aria-invalid={!!fieldErrors.summary} />
          <FieldError errors={fieldErrors.summary} />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="k-tags">Tags</label>
            <input id="k-tags" className="input" value={tags} onChange={(e) => { setTags(e.target.value); setDirty(true); }} placeholder="comma, separated" />
          </div>
          <div className="field">
            <label htmlFor="k-source-type">Where this knowledge comes from</label>
            <select id="k-source-type" className="select" value={form.sourceType} onChange={(e) => change({ sourceType: e.target.value })}>
              {SOURCE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <span className="hint">Add the actual sources on the item page after saving.</span>
          </div>
          <div className="field">
            <label htmlFor="k-confidence">Your confidence, 0–100% <span className="muted">(optional)</span></label>
            <input id="k-confidence" className="input" type="number" min={0} max={100} step={5} value={form.confidence === null ? "" : Math.round(form.confidence * 100)} onChange={(e) => change({ confidence: e.target.value === "" ? null : Math.min(100, Math.max(0, Number(e.target.value))) / 100 })} />
          </div>
        </div>
      </section>

      {scenarioLike && (
        <section className="card padding stack">
          <div>
            <h2 className="sectiontitle">Matching attributes</h2>
            <p className="sub">The Architecture Finder scores this scenario on these values. Tick only what the scenario really covers: an unticked value is reported as a gap, not hidden.</p>
          </div>
          {TOKEN_FIELDS.map((field) => (
            <fieldset key={field.key} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field"><span className="label">{field.label}</span></legend>
              <div className="actions" style={{ gap: "6px 14px" }}>
                {field.groups.flatMap((g) => VOCAB[g]).map((entry) => {
                  const list = form.attributes[field.key] ?? [];
                  return (
                    <label key={entry.token} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                      <input type="checkbox" checked={list.includes(entry.token)} onChange={(e) => attr({ [field.key]: e.target.checked ? [...list, entry.token] : list.filter((t) => t !== entry.token) })} /> {entry.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <div className="form-grid">
            <div className="field">
              <label htmlFor="k-complexity">Operational complexity (1 simple – 5 demanding)</label>
              <select id="k-complexity" className="select" value={form.attributes.complexity ?? ""} onChange={(e) => attr({ complexity: e.target.value ? Number(e.target.value) : undefined })}>
                <option value="">Not recorded</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="k-migration">Migration effort (1 light – 5 heavy)</label>
              <select id="k-migration" className="select" value={form.attributes.migrationEffort ?? ""} onChange={(e) => attr({ migrationEffort: e.target.value ? Number(e.target.value) : undefined })}>
                <option value="">Not recorded</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="k-cost">Billing model</label>
              <select id="k-cost" className="select" value={form.attributes.costModel ?? ""} onChange={(e) => attr({ costModel: (e.target.value || undefined) as KnowledgeAttributes["costModel"] })}>
                <option value="">Not recorded</option><option value="consumption">Mostly consumption-based</option><option value="provisioned">Mostly provisioned capacity</option><option value="mixed">Mixed</option>
              </select>
            </div>
          </div>
          {LINE_FIELDS.map((field) => (
            <div className="field" key={field.key}>
              <label htmlFor={`k-${field.key}`}>{field.label}</label>
              <textarea id={`k-${field.key}`} className="textarea" value={(form.attributes[field.key] ?? []).join("\n")} onChange={(e) => attr({ [field.key]: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) })} />
            </div>
          ))}
          <details>
            <summary className="muted" style={{ cursor: "pointer" }}>Advanced: architecture diagram template (JSON)</summary>
            <div className="field" style={{ marginTop: 8 }}>
              <label htmlFor="k-diagram">Diagram model</label>
              <textarea id="k-diagram" className="textarea code" style={{ minHeight: 220 }} value={diagram} onChange={(e) => { setDiagram(e.target.value); setDirty(true); }} placeholder='{"nodes": [], "edges": []}' />
              <span className="hint">Blueprints created from this scenario start from this diagram. The easiest way to author one is to edit a blueprint diagram and use “Export JSON”.</span>
              <FieldError errors={fieldErrors["attributes.diagram"] ?? fieldErrors["attributes.diagram.nodes"] ?? fieldErrors["attributes.diagram.edges"]} />
            </div>
          </details>
        </section>
      )}

      <section className="card padding stack">
        <div>
          <h2 className="sectiontitle">Article</h2>
          <p className="sub">Markdown. Leave a section empty to omit it.</p>
        </div>
        {ARTICLE_SECTIONS.map((def) => (
          <div className="field" key={def.key}>
            <label htmlFor={`s-${def.key}`}>{def.title}</label>
            <textarea id={`s-${def.key}`} className="textarea" value={sectionBody(def.key)} onChange={(e) => setSection(def.key, def.title, e.target.value)} />
          </div>
        ))}
        {extraSections.map((s) => (
          <div className="field" key={s.key}>
            <label htmlFor={`s-${s.key}`}>{s.title}</label>
            <textarea id={`s-${s.key}`} className="textarea" value={s.body} onChange={(e) => setSection(s.key, s.title, e.target.value)} />
          </div>
        ))}
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn primary" disabled={busy}>{busy ? "Saving…" : form.id ? "Save changes" : "Create as draft"}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => { if (!dirty || window.confirm("Discard your unsaved changes?")) { setDirty(false); router.push(cancelHref); } }}>Cancel</button>
        <span className="muted">{form.id ? "Saving keeps the previous version in the history and returns the item to draft for review." : "New items start as drafts."}</span>
      </div>
      {confirmVerified && (
        <ConfirmDialog title="Edit a verified item?" confirmLabel="Save and return to draft" onClose={() => setConfirmVerified(false)} onConfirm={() => submit(true)}>
          <p>This item is verified. Saving your edit keeps the verified version in the history and returns the item to <strong>draft</strong> until someone verifies the new content.</p>
        </ConfirmDialog>
      )}
    </form>
  );
}
