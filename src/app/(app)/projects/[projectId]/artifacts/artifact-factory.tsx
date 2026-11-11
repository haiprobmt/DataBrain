"use client";

import { diffLines } from "diff";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, Dialog, errorMessage, JobStatus, newKey, useJob, useToast, useUnsavedWarning, type JobView } from "@/components/client";
import { Markdown } from "@/components/markdown";
import { Badge, EmptyState, StatusBadge } from "@/components/ui";
import { ARTIFACT_CATEGORIES, ARTIFACT_DEFS } from "@/lib/artifact-catalog";
import type { ArtifactValidation } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

interface ArtifactRow {
  id: string;
  type: string;
  latest: { version: number; origin: "generated" | "user-edit"; status: ArtifactValidation["status"]; architectureRevisionId: string } | null;
}
interface ManifestRow {
  id: string;
  hash: string;
  createdAt: string;
  revisionVersion: number;
  files: { path: string; version: number; origin: string; validationStatus: string; checksum: string }[];
}
interface Detail {
  artifact: { id: string; name: string; path: string; format: string; type: string };
  revision: { id: string; version: number; origin: "generated" | "user-edit"; content: string; checksum: string; validation: ArtifactValidation; createdAt: string; architectureRevisionId: string; templateVersion: string };
  versions: { id: string; version: number; origin: string; createdAt: string }[];
}

export function ArtifactFactory({ projectId, approved, artifacts, manifests, readOnly }: { projectId: string; approved: { id: string; version: number; title: string } | null; artifacts: ArtifactRow[]; manifests: ManifestRow[]; readOnly: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>(() => ARTIFACT_DEFS.map((d) => d.type));
  const [conflict, setConflict] = useState<{ name: string; version: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [chosenId, setOpenId] = useState<string | null>(null);
  const openId = chosenId ?? artifacts[0]?.id ?? null;
  const [viewVersion, setViewVersion] = useState<number | undefined>(undefined);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "raw" | "diff" | "edit">("view");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const base = `/api/projects/${projectId}`;

  const { job, setJob, pollError, running } = useJob((finished) => {
    if (finished.status === "succeeded") {
      const kept = (finished.result?.kept as string[] | undefined) ?? [];
      toast(`Generated ${String(finished.result?.generated ?? 0)} artifact(s)${kept.length ? `, kept ${kept.length} hand-edited` : ""}.`);
    }
    router.refresh();
  });

  const latestKey = artifacts.map((a) => `${a.id}:${a.latest?.version}`).join(",");
  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    void (async () => {
      try {
        const d = await api<Detail>(`${base}/artifacts/${openId}${viewVersion ? `?version=${viewVersion}` : ""}`);
        const before = d.revision.version > 1 ? (await api<Detail>(`${base}/artifacts/${openId}?version=${d.revision.version - 1}`)).revision.content : null;
        if (cancelled) return;
        setDetailError(null);
        setDetail(d);
        setDraft(d.revision.content);
        setPrevious(before);
      } catch (e) {
        if (!cancelled) setDetailError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openId, viewVersion, base, latestKey]);

  const dirty = mode === "edit" && detail !== null && draft !== detail.revision.content;
  useUnsavedWarning(dirty);

  const generate = async (onEdited?: "keep" | "replace") => {
    if (!approved) return;
    setError(null);
    setConflict(null);
    setStarting(true);
    try {
      setJob(await api<JobView>(`${base}/artifacts/generate`, { body: { revisionId: approved.id, types: selected, onEdited, idempotencyKey: newKey() } }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "conflict" && Array.isArray(e.details.edited)) setConflict(e.details.edited as { name: string; version: number }[]);
      else setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };
  const open = (id: string) => {
    setOpenId(id);
    setViewVersion(undefined);
    setMode("view");
  };
  const row = (type: string) => artifacts.find((a) => a.type === type);
  const isLatest = detail ? detail.revision.version === Math.max(...detail.versions.map((v) => v.version)) : false;

  return (
    <div className="stack">
      <div className="gridtwo" style={{ ["--cols" as string]: "minmax(0, 0.8fr) minmax(0, 1.2fr)" }}>
        <section className="card padding">
          <div className="pane-head">
            <h2>Artifacts</h2>
            <span className="muted">{approved ? `From approved blueprint v${approved.version}` : "No approved blueprint"}</span>
          </div>
          {!approved && <p className="note warn">The blueprint these files came from is no longer the approved revision. Approve a revision to generate again.</p>}
          {ARTIFACT_CATEGORIES.map((category) => (
            <fieldset key={category} style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
              <legend className="muted" style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, fontSize: 10.5 }}>{category}</legend>
              {ARTIFACT_DEFS.filter((d) => d.category === category).map((def) => {
                const r = row(def.type);
                return (
                  <div key={def.type} className="checkrow">
                    <input type="checkbox" id={`a-${def.type}`} checked={selected.includes(def.type)} disabled={readOnly || !approved} onChange={(e) => setSelected(e.target.checked ? [...selected, def.type] : selected.filter((t) => t !== def.type))} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <label htmlFor={`a-${def.type}`}><strong>{def.name}</strong></label>
                      <span>{def.description}</span>
                      {r?.latest && (
                        <div className="actions" style={{ marginTop: 5, gap: 6 }}>
                          <button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={() => open(r.id)} aria-current={openId === r.id}>{def.path}</button>
                          <Badge>v{r.latest.version}</Badge>
                          {r.latest.origin === "user-edit" && <Badge tone="info">Edited by you</Badge>}
                          <StatusBadge status={r.latest.status} label={r.latest.status === "passed" ? "Checks passed" : r.latest.status === "warning" ? "Has placeholders" : "Checks failed"} />
                          {approved && r.latest.architectureRevisionId !== approved.id && <Badge tone="warn" title="Generated from an earlier blueprint revision">Older revision</Badge>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </fieldset>
          ))}
          {error && <p className="form-error" role="alert">{error}</p>}
          <JobStatus job={job} pollError={pollError} noun="Generation" />
          {job?.status === "succeeded" && ((job.result?.failedValidation as string[] | undefined)?.length ?? 0) > 0 && <p className="form-error">Checks failed for: {(job.result!.failedValidation as string[]).join(", ")}.</p>}
          {!readOnly && (
            <div className="actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn primary" disabled={!approved || selected.length === 0 || running || starting} onClick={() => generate()}>
                {running || starting ? "Generating…" : artifacts.length ? `Regenerate ${selected.length} selected` : `Generate ${selected.length} selected`}
              </button>
              <button type="button" className="btn mini" onClick={() => setSelected(selected.length ? [] : ARTIFACT_DEFS.map((d) => d.type))}>{selected.length ? "Select none" : "Select all"}</button>
            </div>
          )}
          <p className="muted" style={{ marginTop: 10 }}>Files are produced by fixed templates from the approved blueprint — no generative model. Each is labelled generated and not validated until you review it.</p>
        </section>

        <section className="card padding" aria-live="polite">
          {!openId ? (
            <EmptyState title="Nothing generated yet">Select the artifacts you need and choose Generate. A preview, its checks and its version history appear here.</EmptyState>
          ) : detailError ? (
            <p className="form-error" role="alert">{detailError}</p>
          ) : !detail ? (
            <div className="skeleton" style={{ height: 300 }} aria-busy="true" />
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              <div className="pane-head" style={{ marginBottom: 0 }}>
                <div>
                  <h2>{detail.artifact.name}</h2>
                  <p className="sub"><code>{detail.artifact.path}</code> · version {detail.revision.version} · {detail.revision.origin === "user-edit" ? "edited by a person" : `generated, template ${detail.revision.templateVersion}`} · {formatDateTime(detail.revision.createdAt)}</p>
                </div>
                <div className="actions">
                  <a className="btn mini" href={`${base}/artifacts/${detail.artifact.id}/download?version=${detail.revision.version}`}>Download</a>
                  {detail.artifact.format === "markdown" && <a className="btn mini" href={`${base}/artifacts/${detail.artifact.id}/download?version=${detail.revision.version}&format=docx`}>Download DOCX</a>}
                </div>
              </div>
              <div className="tabs" role="tablist" style={{ marginBottom: 0 }}>
                {(["view", "raw", "diff", "edit"] as const).filter((m) => (m !== "view" || detail.artifact.format === "markdown") && (m !== "edit" || (!readOnly && isLatest))).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "current" : undefined} onClick={() => setMode(m)}>
                    {m === "view" ? "Preview" : m === "raw" ? "Source" : m === "diff" ? "Changes from previous version" : "Edit"}
                  </button>
                ))}
              </div>
              {mode === "edit" ? (
                <>
                  <label htmlFor="artifact-edit" className="sr-only">Edit {detail.artifact.name}</label>
                  <textarea id="artifact-edit" className="textarea code" style={{ minHeight: 460 }} value={draft} onChange={(e) => setDraft(e.target.value)} />
                  <div className="actions">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!dirty || saving}
                      onClick={async () => {
                        setSaving(true);
                        setDetailError(null);
                        try {
                          await api(`${base}/artifacts/${detail.artifact.id}`, { method: "PUT", body: { content: draft, expectedVersion: detail.revision.version } });
                          toast("Saved as a new version. Regeneration will ask before replacing your edit.");
                          setMode("raw");
                          setViewVersion(undefined);
                          router.refresh();
                        } catch (e) {
                          setDetailError(errorMessage(e));
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      {saving ? "Saving…" : "Save as new version"}
                    </button>
                    <button type="button" className="btn" onClick={() => { setDraft(detail.revision.content); setMode("raw"); }}>Cancel</button>
                  </div>
                </>
              ) : mode === "diff" ? (
                previous === null ? <p className="muted">This is the first version; there is nothing to compare it with.</p> : (
                  <pre className="diff" tabIndex={0} aria-label="Line changes from the previous version">
                    {diffLines(previous, detail.revision.content).map((part, i) => (
                      <span key={i} className={part.added ? "diff-add" : part.removed ? "diff-del" : "diff-same"}>
                        {part.value.replace(/\n$/, "").split("\n").map((line) => `${part.added ? "+" : part.removed ? "-" : " "} ${line}`).join("\n")}
                      </span>
                    ))}
                  </pre>
                )
              ) : mode === "view" && detail.artifact.format === "markdown" ? (
                <div style={{ maxHeight: 560, overflow: "auto" }} tabIndex={0} role="region" aria-label="Document preview"><Markdown text={detail.revision.content} /></div>
              ) : (
                <pre className="code" tabIndex={0}>{detail.revision.content}</pre>
              )}
              <div className="form-grid">
                <div>
                  <strong>Checks</strong>
                  {detail.revision.validation.checks.map((c) => (
                    <div key={c.name} className="checkrow"><div><strong>{c.name} <StatusBadge status={c.status} /></strong><span>{c.detail}</span></div></div>
                  ))}
                </div>
                <div>
                  <strong>Versions</strong>
                  {detail.versions.map((v) => (
                    <div key={v.id} className="checkrow" style={{ justifyContent: "space-between" }}>
                      <button type="button" className="linkbtn" aria-current={v.version === detail.revision.version} onClick={() => { setViewVersion(v.version); if (mode === "edit") setMode("raw"); }}>
                        Version {v.version}{v.version === detail.revision.version ? " (shown)" : ""}
                      </button>
                      <span>{v.origin === "user-edit" ? "edited" : "generated"} · {formatDateTime(v.createdAt)}</span>
                    </div>
                  ))}
                  <p className="muted" style={{ marginTop: 6 }}>SHA-256 <code>{detail.revision.checksum.slice(0, 20)}…</code></p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="card padding">
        <div className="pane-head"><h2>Generation manifests</h2><span className="muted">Immutable record of each generation: files, versions, checksums and sources.</span></div>
        {manifests.length === 0 ? (
          <EmptyState title="No packages yet">Each generation writes a manifest. From it you can export the whole package as a ZIP, ready to commit to Git.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Generated</th><th>Blueprint</th><th>Files</th><th>Manifest hash</th><th>Export</th></tr></thead>
              <tbody>
                {manifests.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDateTime(m.createdAt)}</td>
                    <td>v{m.revisionVersion}</td>
                    <td>
                      <details><summary>{m.files.length} files</summary><ul style={{ paddingLeft: 16, margin: "6px 0 0" }}>{m.files.map((f) => <li key={f.path}><code>{f.path}</code> v{f.version}{f.origin === "user-edit" ? " (edited)" : ""} · {f.validationStatus}</li>)}</ul></details>
                    </td>
                    <td><code>{m.hash.slice(0, 16)}…</code></td>
                    <td><a className="btn mini" href={`${base}/manifests/${m.id}/download`}>Download ZIP</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {conflict && (
        <Dialog title="Some artifacts were edited by hand" onClose={() => setConflict(null)}>
          <div className="prose">
            <p>These artifacts have edits you made after they were generated:</p>
            <ul>{conflict.map((c) => <li key={c.name}>{c.name} (version {c.version})</li>)}</ul>
            <p>Your edited versions stay in the history either way.</p>
          </div>
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
