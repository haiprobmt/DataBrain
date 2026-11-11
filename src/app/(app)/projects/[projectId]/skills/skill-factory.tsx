"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError, Dialog, errorMessage, JobStatus, newKey, useAction, useJob, useToast, useUnsavedWarning, type JobView } from "@/components/client";
import { Markdown } from "@/components/markdown";
import { Badge, EmptyState, StatusBadge } from "@/components/ui";
import type { SkillCompatibility, SkillFile, SkillValidation } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/utils";

interface SkillView {
  id: string;
  name: string;
  kind: "platform" | "pattern" | "scenario" | "validation";
  title: string;
  dependsOn: { name: string; reason: string }[];
  version: number;
  origin: "generated" | "user-edit";
  skillMd: string;
  files: SkillFile[];
  compatibility: SkillCompatibility;
  validation: SkillValidation;
  architectureRevisionId: string;
  versions: { version: number; origin: string; createdAt: string }[];
}
interface PackageView {
  id: string;
  version: number;
  name: string;
  createdAt: string;
  checksum: string;
  manifest: { executionOrder: string[]; conflicts: { skills: string[]; reason: string }[]; skills: { name: string; version: number }[] };
}

const KINDS = [
  { key: "platform", label: "Platform skills" },
  { key: "pattern", label: "Architecture pattern skills" },
  { key: "scenario", label: "Scenario skill" },
  { key: "validation", label: "Validation skill" },
] as const;

export function SkillFactory({ projectId, approved, skills, packages, readOnly }: { projectId: string; approved: { id: string; version: number } | null; skills: SkillView[]; packages: PackageView[]; readOnly: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const base = `/api/projects/${projectId}/skills`;
  const [openId, setOpenId] = useState<string | null>(skills.find((s) => s.kind === "scenario")?.id ?? skills[0]?.id ?? null);
  const [file, setFile] = useState<string>("SKILL.md");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [conflict, setConflict] = useState<{ name: string; version: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const { run, busy, error: actionError } = useAction();
  const { job, setJob, pollError, running } = useJob((finished) => {
    if (finished.status === "succeeded") toast(`Generated ${((finished.result?.skills as string[] | undefined) ?? []).length} skill(s).`);
    router.refresh();
  });
  const skill = skills.find((s) => s.id === openId) ?? skills[0] ?? null;
  const dirty = editing && skill !== null && draft !== skill.skillMd;
  useUnsavedWarning(dirty);
  const invalid = skills.filter((s) => !s.validation.valid);
  const stale = approved ? skills.filter((s) => s.architectureRevisionId !== approved.id) : [];

  const generate = async (onEdited?: "keep" | "replace") => {
    if (!approved) return;
    setError(null);
    setConflict(null);
    setStarting(true);
    try {
      setJob(await api<JobView>(`${base}/generate`, { body: { revisionId: approved.id, onEdited, idempotencyKey: newKey() } }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "conflict" && Array.isArray(e.details.edited)) setConflict(e.details.edited as { name: string; version: number }[]);
      else setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };
  const content = skill ? (file === "SKILL.md" ? skill.skillMd : (skill.files.find((f) => f.path === file)?.content ?? "")) : "";

  return (
    <div className="stack">
      <div className="gridtwo" style={{ ["--cols" as string]: "minmax(0, 0.7fr) minmax(0, 1.3fr)" }}>
        <section className="card padding">
          <div className="pane-head"><h2>Skill tree</h2><span className="muted">{approved ? `Blueprint v${approved.version}` : "No approved blueprint"}</span></div>
          {skills.length === 0 ? (
            <EmptyState title="No skills yet">Generate a composable set of agent skills: one per platform and pattern in the blueprint, one for implementing the solution, one for validating it.</EmptyState>
          ) : (
            KINDS.map((kind) => {
              const list = skills.filter((s) => s.kind === kind.key);
              if (list.length === 0) return null;
              return (
                <div key={kind.key} style={{ marginBottom: 12 }}>
                  <p className="muted" style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, fontSize: 10.5, margin: "0 0 4px" }}>{kind.label}</p>
                  {list.map((s) => (
                    <button key={s.id} type="button" className="option" style={{ marginBottom: 6 }} aria-pressed={skill?.id === s.id} onClick={() => { setOpenId(s.id); setFile("SKILL.md"); setEditing(false); }}>
                      <strong style={{ fontSize: 12.5 }}><code>{s.name}</code></strong>
                      <span className="actions" style={{ gap: 6, marginTop: 5 }}>
                        <Badge>v{s.version}</Badge>
                        {s.origin === "user-edit" && <Badge tone="info">Edited by you</Badge>}
                        <StatusBadge status={s.validation.valid ? "valid" : "invalid"} label={s.validation.valid ? "Valid" : `${s.validation.errors.length} error(s)`} />
                      </span>
                    </button>
                  ))}
                </div>
              );
            })
          )}
          {stale.length > 0 && <p className="note warn">{stale.length} skill(s) were generated from an earlier blueprint revision. Regenerate before packaging.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <JobStatus job={job} pollError={pollError} noun="Skill generation" />
          {!readOnly && (
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="button" className="btn primary" disabled={!approved || running || starting} onClick={() => generate()}>{running || starting ? "Generating…" : skills.length ? "Regenerate skills" : "Generate skills"}</button>
            </div>
          )}
          <p className="muted" style={{ marginTop: 10 }}>Generating a skill never executes it. Skills are instructions for an agent; they contain no secrets.</p>
        </section>

        <section className="card padding">
          {!skill ? (
            <EmptyState title="Select a skill">Its SKILL.md, reference files, dependencies and compatibility appear here.</EmptyState>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              <div className="pane-head" style={{ marginBottom: 0 }}>
                <div><h2>{skill.title}</h2><p className="sub"><code>{skill.name}/</code> · version {skill.version} · {skill.origin === "user-edit" ? "edited by a person" : "generated, not validated"}</p></div>
                {!readOnly && file === "SKILL.md" && !editing && <button type="button" className="btn mini" onClick={() => { setDraft(skill.skillMd); setEditing(true); }}>Edit SKILL.md</button>}
              </div>
              <div className="tabs" role="tablist" style={{ marginBottom: 0 }}>
                {["SKILL.md", ...skill.files.map((f) => f.path)].map((path) => (
                  <button key={path} type="button" role="tab" aria-selected={file === path} className={file === path ? "current" : undefined} onClick={() => { setFile(path); setEditing(false); }}>{path}</button>
                ))}
              </div>
              {editing ? (
                <>
                  <label htmlFor="skill-edit" className="sr-only">Edit SKILL.md</label>
                  <textarea id="skill-edit" className="textarea code" style={{ minHeight: 440 }} value={draft} onChange={(e) => setDraft(e.target.value)} />
                  {actionError && <p className="form-error" role="alert">{actionError.message}</p>}
                  <div className="actions">
                    <button type="button" className="btn primary" disabled={!dirty || !!busy} onClick={async () => { const r = await run("save", () => api<{ validation: SkillValidation }>(`${base}/${skill.id}`, { method: "PUT", body: { skillMd: draft, expectedVersion: skill.version } })); if (r) { setEditing(false); toast(r.validation.valid ? "Saved as a new version. It passes validation." : "Saved, but the skill has validation errors."); } }}>{busy === "save" ? "Saving…" : "Save as new version"}</button>
                    <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </>
              ) : file.endsWith(".md") ? (
                <div style={{ maxHeight: 520, overflow: "auto" }} tabIndex={0} role="region" aria-label="File preview">
                  {file === "SKILL.md" && <pre className="code" tabIndex={0} style={{ marginBottom: 12, maxHeight: 130 }}>{skill.skillMd.match(/^---[\s\S]*?---/)?.[0] ?? "(no frontmatter)"}</pre>}
                  <Markdown text={content.replace(/^---[\s\S]*?---\s*/, "")} />
                </div>
              ) : (
                <pre className="code" tabIndex={0}>{content}</pre>
              )}
              <div className="form-grid">
                <div>
                  <strong>Validation</strong>
                  {skill.validation.valid && skill.validation.warnings.length === 0 && <p className="form-ok" style={{ marginTop: 6 }}>Meets the packaging rules: name, description, required sections, no secrets.</p>}
                  {skill.validation.errors.map((e, i) => <p key={i} className="form-error" style={{ marginTop: 6 }}>{e}</p>)}
                  {skill.validation.warnings.map((w, i) => <p key={i} className="note warn" style={{ marginTop: 6 }}>{w}</p>)}
                  <strong style={{ display: "block", marginTop: 12 }}>Depends on</strong>
                  {skill.dependsOn.length ? skill.dependsOn.map((d) => <div key={d.name} className="checkrow"><div><strong><code>{d.name}</code></strong><span>{d.reason}</span></div></div>) : <p className="muted">No dependencies.</p>}
                </div>
                <div>
                  <strong>Compatibility</strong>
                  <dl className="kv" style={{ marginTop: 6 }}>
                    <dt>Platforms</dt><dd>{skill.compatibility.platforms.join(", ") || "Not recorded"}</dd>
                    <dt>Services</dt><dd>{skill.compatibility.services.join(", ") || "Not recorded"}</dd>
                    <dt>Versions</dt><dd>{skill.compatibility.versionConstraints}</dd>
                    <dt>Regions</dt><dd>{skill.compatibility.regionConstraints}</dd>
                    <dt>Last verified</dt><dd>{skill.compatibility.lastVerifiedAt ? formatDate(skill.compatibility.lastVerifiedAt) : "Never — source knowledge is unverified"}</dd>
                    <dt>Notes</dt><dd>{skill.compatibility.notes}</dd>
                  </dl>
                  <strong style={{ display: "block", marginTop: 12 }}>Versions</strong>
                  {skill.versions.map((v) => <div key={v.version} className="checkrow" style={{ justifyContent: "space-between" }}><span>Version {v.version}{v.version === skill.version ? " (current)" : ""}</span><span>{v.origin === "user-edit" ? "edited" : "generated"} · {formatDateTime(v.createdAt)}</span></div>)}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="card padding">
        <div className="pane-head">
          <h2>Skill packages</h2>
          {!readOnly && (
            <button type="button" className="btn primary" disabled={skills.length === 0 || invalid.length > 0 || stale.length > 0 || !!busy} title={invalid.length ? "Fix validation errors first" : undefined} onClick={() => run("package", () => api(`${base}/packages`, { body: {} }), "Skill package built.")}>
              {busy === "package" ? "Building…" : "Build package"}
            </button>
          )}
        </div>
        {invalid.length > 0 && <p className="form-error">Fix the validation errors in {invalid.map((s) => s.name).join(", ")} before packaging.</p>}
        {actionError && !editing && <p className="form-error" role="alert">{actionError.message}</p>}
        {packages.length === 0 ? (
          <EmptyState title="No packages yet">A package bundles the current version of every skill with a README, manifest, dependency map and execution order, as a ZIP ready for Git.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Package</th><th>Built</th><th>Execution order</th><th>Conflicts</th><th>Export</th></tr></thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong> v{p.version}<div className="muted"><code>{p.checksum.slice(0, 16)}…</code></div></td>
                    <td>{formatDateTime(p.createdAt)}</td>
                    <td><ol style={{ margin: 0, paddingLeft: 18 }}>{p.manifest.executionOrder.map((n) => <li key={n}><code>{n}</code></li>)}</ol></td>
                    <td>{p.manifest.conflicts.length ? p.manifest.conflicts.map((c, i) => <div key={i}><Badge tone="warn">Kept separate</Badge> {c.skills.join(" / ")}<div className="muted">{c.reason}</div></div>) : <span className="muted">None detected</span>}</td>
                    <td><a className="btn mini" href={`${base}/packages/${p.id}/download`}>Download ZIP</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {conflict && (
        <Dialog title="Some skills were edited by hand" onClose={() => setConflict(null)}>
          <div className="prose"><ul>{conflict.map((c) => <li key={c.name}><code>{c.name}</code> (version {c.version})</li>)}</ul><p>Your edited versions stay in the history either way.</p></div>
          <div className="actions" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" className="btn" onClick={() => setConflict(null)}>Cancel</button>
            <button type="button" className="btn" onClick={() => generate("replace")}>Replace with new generation</button>
            <button type="button" className="btn primary" onClick={() => generate("keep")}>Keep my edits</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
