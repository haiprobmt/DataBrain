"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { FieldError, useUnsavedWarning } from "@/components/client";
import { useFormSubmit, useSubmit } from "@/components/lifecycle/shared";
import { CHECKLIST_ITEM_TYPES, READINESS_RULES, READINESS_RULE_LABELS, type ChecklistItemType, type ReadinessRule } from "@/lib/lifecycle";
import { slugify } from "@/lib/utils";
import type { TemplateView } from "@/server/services/lifecycle-templates";

interface ItemDraft {
  uid: string;
  title: string;
  description: string;
  itemType: ChecklistItemType;
  isRequired: boolean;
}

interface StageDraft {
  uid: string;
  /** Stages that already exist keep their key; a new stage gets one from its name. */
  existing: boolean;
  stageKey: string;
  name: string;
  description: string;
  isRequired: boolean;
  requiresApproval: boolean;
  defaultDurationDays: string;
  readinessRules: ReadinessRule[];
  checklist: ItemDraft[];
}

// The approval rule is driven by "requires approval", so it is not offered as a separate tick box.
const CONDITION_RULES = READINESS_RULES.filter((r) => r !== "stage_approval_recorded");
const TYPE_LABEL: Record<ChecklistItemType, string> = { task: "Task", deliverable: "Deliverable", evidence: "Evidence", review: "Review" };
let counter = 0;
const uid = () => `n${(counter += 1)}`;

const toDraft = (template: TemplateView): StageDraft[] =>
  template.stages.map((s) => ({
    uid: s.id,
    existing: true,
    stageKey: s.stageKey,
    name: s.name,
    description: s.description,
    isRequired: s.isRequired,
    requiresApproval: s.requiresApproval,
    defaultDurationDays: s.defaultDurationDays ? String(s.defaultDurationDays) : "",
    readinessRules: s.readinessRules.filter((r) => r !== "stage_approval_recorded"),
    checklist: s.checklist.map((c) => ({ uid: c.id, title: c.title, description: c.description, itemType: c.itemType, isRequired: c.isRequired })),
  }));

const keyFor = (name: string, taken: string[]) => {
  const base = slugify(name).replace(/-/g, "_").replace(/^[^a-z]+/, "").slice(0, 36) || "stage";
  let key = base.length < 2 ? `${base}_stage` : base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}_${n}`;
  return key;
};

export function TemplateEditor({ template, readOnly }: { template: TemplateView; readOnly: boolean }) {
  const submitTo = useSubmit();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [stages, setStages] = useState<StageDraft[]>(() => toDraft(template));
  const [dirty, setDirty] = useState(false);
  useUnsavedWarning(dirty && !readOnly);

  const touch = () => setDirty(true);
  const patchStage = (id: string, patch: Partial<StageDraft>) => {
    setStages((list) => list.map((s) => (s.uid === id ? { ...s, ...patch } : s)));
    touch();
  };
  const patchItem = (stageId: string, itemId: string, patch: Partial<ItemDraft>) => {
    setStages((list) => list.map((s) => (s.uid === stageId ? { ...s, checklist: s.checklist.map((c) => (c.uid === itemId ? { ...c, ...patch } : c)) } : s)));
    touch();
  };
  const move = (index: number, by: number) => {
    setStages((list) => {
      const next = [...list];
      const [stage] = next.splice(index, 1);
      next.splice(index + by, 0, stage!);
      return next;
    });
    touch();
  };

  const { busy, error, fieldErrors, submit } = useFormSubmit(async () => {
    const taken: string[] = stages.filter((s) => s.existing).map((s) => s.stageKey);
    const body = {
      name,
      description,
      expectedVersion: template.version,
      stages: stages.map((s) => {
        const stageKey = s.existing ? s.stageKey : keyFor(s.name, taken);
        if (!s.existing) taken.push(stageKey);
        return {
          stageKey,
          name: s.name,
          description: s.description,
          isRequired: s.isRequired,
          requiresApproval: s.requiresApproval,
          defaultDurationDays: s.defaultDurationDays.trim() ? Number(s.defaultDurationDays) : null,
          readinessRules: s.readinessRules,
          checklist: s.checklist.map((c) => ({ title: c.title, description: c.description, itemType: c.itemType, isRequired: c.isRequired })),
        };
      }),
    };
    await submitTo(`/api/lifecycle-templates/${template.id}`, { method: "PUT", body }, `Template saved as version ${template.version + 1}.`);
    setDirty(false);
  });
  const stageErrors = (index: number, field: string) => fieldErrors[`stages.${index}.${field}`];

  return (
    <form onSubmit={submit} noValidate className="card padding" aria-labelledby="template-stages-title">
      <div className="pane-head">
        <h2 id="template-stages-title">Stages and checklists</h2>
        <span className="muted">{stages.length} stage{stages.length === 1 ? "" : "s"} · {stages.reduce((n, s) => n + s.checklist.length, 0)} checklist items</span>
      </div>
      <fieldset disabled={readOnly || busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <legend className="sr-only">Template definition</legend>
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <div className="field">
            <label htmlFor="template-edit-name">Template name</label>
            <input id="template-edit-name" className="input" value={name} onChange={(e) => { setName(e.target.value); touch(); }} aria-invalid={!!fieldErrors.name} />
            <FieldError errors={fieldErrors.name} />
          </div>
          <div className="field">
            <label htmlFor="template-edit-description">Description</label>
            <input id="template-edit-description" className="input" value={description} onChange={(e) => { setDescription(e.target.value); touch(); }} />
          </div>
        </div>

        {stages.map((stage, index) => (
          <section key={stage.uid} className="stage-editor" aria-label={`Stage ${index + 1}: ${stage.name || "new stage"}`}>
            <div className="pane-head" style={{ marginBottom: 10 }}>
              <h3>{index + 1}. {stage.name || "New stage"} <span className="muted">· {stage.existing ? <code>{stage.stageKey}</code> : "new"}</span></h3>
              {!readOnly && (
                <div className="actions">
                  <button type="button" className="btn mini" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${stage.name || "stage"} up`}><ArrowUp aria-hidden /></button>
                  <button type="button" className="btn mini" onClick={() => move(index, 1)} disabled={index === stages.length - 1} aria-label={`Move ${stage.name || "stage"} down`}><ArrowDown aria-hidden /></button>
                  <button type="button" className="btn mini danger" onClick={() => { setStages((list) => list.filter((s) => s.uid !== stage.uid)); touch(); }} disabled={stages.length === 1} aria-label={`Remove stage ${stage.name || index + 1}`}><Trash2 aria-hidden /> Remove</button>
                </div>
              )}
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor={`stage-name-${stage.uid}`}>Stage name</label>
                <input id={`stage-name-${stage.uid}`} className="input" value={stage.name} onChange={(e) => patchStage(stage.uid, { name: e.target.value })} aria-invalid={!!stageErrors(index, "name")} />
                <FieldError errors={stageErrors(index, "name") ?? stageErrors(index, "stageKey")} />
              </div>
              <div className="field">
                <label htmlFor={`stage-duration-${stage.uid}`}>Typical duration in days <span className="muted">(optional)</span></label>
                <input id={`stage-duration-${stage.uid}`} className="input" type="number" min={1} max={3650} value={stage.defaultDurationDays} onChange={(e) => patchStage(stage.uid, { defaultDurationDays: e.target.value })} aria-invalid={!!stageErrors(index, "defaultDurationDays")} />
                <FieldError errors={stageErrors(index, "defaultDurationDays")} />
              </div>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor={`stage-description-${stage.uid}`}>Purpose</label>
              <input id={`stage-description-${stage.uid}`} className="input" value={stage.description} onChange={(e) => patchStage(stage.uid, { description: e.target.value })} />
            </div>
            <div className="checks" style={{ marginTop: 12 }}>
              <label><input type="checkbox" checked={stage.isRequired} onChange={(e) => patchStage(stage.uid, { isRequired: e.target.checked })} /> Required stage</label>
              <label><input type="checkbox" checked={stage.requiresApproval} onChange={(e) => patchStage(stage.uid, { requiresApproval: e.target.checked })} /> Requires approval to complete</label>
            </div>
            <fieldset style={{ marginTop: 12 }}>
              <legend>Gate conditions</legend>
              <div className="checks">
                {CONDITION_RULES.map((rule) => (
                  <label key={rule} title={READINESS_RULE_LABELS[rule].help}>
                    <input type="checkbox" checked={stage.readinessRules.includes(rule)} onChange={(e) => patchStage(stage.uid, { readinessRules: e.target.checked ? [...stage.readinessRules, rule] : stage.readinessRules.filter((r) => r !== rule) })} /> {READINESS_RULE_LABELS[rule].label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset style={{ marginTop: 12 }}>
              <legend>Checklist ({stage.checklist.length})</legend>
              {stage.checklist.length === 0 && <p className="muted" style={{ margin: 0 }}>No checklist items.</p>}
              {stage.checklist.map((item, itemIndex) => (
                <div key={item.uid} className="def-row">
                  <div>
                    <label className="sr-only" htmlFor={`item-title-${item.uid}`}>Checklist item {itemIndex + 1} of {stage.name || "stage"}</label>
                    <input id={`item-title-${item.uid}`} className="input" value={item.title} onChange={(e) => patchItem(stage.uid, item.uid, { title: e.target.value })} aria-invalid={!!fieldErrors[`stages.${index}.checklist.${itemIndex}.title`]} />
                    <FieldError errors={fieldErrors[`stages.${index}.checklist.${itemIndex}.title`]} />
                  </div>
                  <div>
                    <label className="sr-only" htmlFor={`item-type-${item.uid}`}>Type of item {itemIndex + 1}</label>
                    <select id={`item-type-${item.uid}`} className="select" value={item.itemType} onChange={(e) => patchItem(stage.uid, item.uid, { itemType: e.target.value as ChecklistItemType })}>
                      {CHECKLIST_ITEM_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                    </select>
                  </div>
                  <span className="checks"><label><input type="checkbox" checked={item.isRequired} onChange={(e) => patchItem(stage.uid, item.uid, { isRequired: e.target.checked })} /> Required</label></span>
                  {!readOnly && <button type="button" className="btn mini danger" onClick={() => patchStage(stage.uid, { checklist: stage.checklist.filter((c) => c.uid !== item.uid) })} aria-label={`Remove checklist item ${itemIndex + 1} of ${stage.name || "stage"}`}><Trash2 aria-hidden /></button>}
                </div>
              ))}
              {!readOnly && <button type="button" className="btn mini" style={{ marginTop: 10 }} onClick={() => patchStage(stage.uid, { checklist: [...stage.checklist, { uid: uid(), title: "", description: "", itemType: "task", isRequired: true }] })}><Plus aria-hidden /> Add checklist item</button>}
            </fieldset>
          </section>
        ))}
      </fieldset>

      {!readOnly && (
        <>
          <FieldError errors={fieldErrors.stages} />
          {error && <p className="form-error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
          <div className="actions" style={{ marginTop: 14 }}>
            <button type="button" className="btn" disabled={busy} onClick={() => { setStages((list) => [...list, { uid: uid(), existing: false, stageKey: "", name: "", description: "", isRequired: true, requiresApproval: true, defaultDurationDays: "", readinessRules: ["required_checklist_complete"], checklist: [] }]); touch(); }}><Plus aria-hidden /> Add stage</button>
            <button className="btn primary" disabled={busy || !dirty}>{busy ? "Saving…" : "Save template"}</button>
            {dirty && <button type="button" className="btn" disabled={busy} onClick={() => { setName(template.name); setDescription(template.description); setStages(toDraft(template)); setDirty(false); }}>Discard changes</button>}
          </div>
          <p className="muted" style={{ margin: "10px 0 0" }}>Saving creates version {template.version + 1}. Lifecycles that are already running keep the stages and checklist they started with; the new version applies to lifecycles started from now on.</p>
        </>
      )}
    </form>
  );
}
