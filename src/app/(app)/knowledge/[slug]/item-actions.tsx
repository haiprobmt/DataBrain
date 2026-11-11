"use client";

import { useEffect, useState } from "react";
import { api, ConfirmDialog, FieldError, useAction } from "@/components/client";
import { RELATIONSHIP_TYPES, SOURCE_TYPES } from "@/lib/catalog";

export function StatusActions({ id, status, hasSources }: { id: string; status: string; hasSources: boolean }) {
  const { run, busy, error } = useAction();
  const [confirm, setConfirm] = useState<"verified" | "archived" | null>(null);
  const set = (next: string, message: string) => run(next, () => api(`/api/knowledge/${id}/status`, { body: { status: next } }), message);
  return (
    <div style={{ marginTop: 14 }}>
      <div className="actions">
        {status === "draft" && <button type="button" className="btn" disabled={!!busy} onClick={() => set("reviewed", "Marked as reviewed.")}>Mark reviewed</button>}
        {(status === "draft" || status === "reviewed") && <button type="button" className="btn primary" disabled={!!busy || !hasSources} title={hasSources ? undefined : "Add a source first"} onClick={() => setConfirm("verified")}>Mark verified</button>}
        {status === "verified" && <button type="button" className="btn" disabled={!!busy} onClick={() => setConfirm("verified")}>Record re-verification</button>}
        {(status === "reviewed" || status === "verified" || status === "archived") && <button type="button" className="btn" disabled={!!busy} onClick={() => set("draft", "Returned to draft.")}>Return to draft</button>}
        {status !== "archived" && <button type="button" className="btn danger" disabled={!!busy} onClick={() => setConfirm("archived")}>Archive</button>}
      </div>
      {!hasSources && status !== "verified" && status !== "archived" && <p className="muted" style={{ marginTop: 6 }}>Verification needs at least one cited source.</p>}
      {error && <p className="form-error" role="alert" style={{ marginTop: 8 }}>{error.message}</p>}
      {confirm === "verified" && (
        <ConfirmDialog title="Mark as verified?" confirmLabel="I have checked it — mark verified" onClose={() => setConfirm(null)} onConfirm={async () => { await api(`/api/knowledge/${id}/status`, { body: { status: "verified" } }); await run("refresh", async () => undefined, "Marked as verified."); }}>
          <p>Verified means you have checked this content against the cited sources, or against evidence from a real project. Your name and today&rsquo;s date are recorded as the verification.</p>
        </ConfirmDialog>
      )}
      {confirm === "archived" && (
        <ConfirmDialog title="Archive this item?" confirmLabel="Archive" danger onClose={() => setConfirm(null)} onConfirm={async () => { await api(`/api/knowledge/${id}/status`, { body: { status: "archived" } }); await run("refresh", async () => undefined, "Archived."); }}>
          <p>Archived items are kept with their history but leave search, the graph and Architecture Finder matching. You can return the item to draft later.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

export function SourceManager({ itemId, attached, available, locked }: { itemId: string; attached: { id: string; title: string }[]; available: { id: string; title: string }[]; locked: boolean }) {
  const { run, busy, error, fieldErrors } = useAction();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", url: "", publisher: "", sourceType: "vendor-official" });
  const [existing, setExisting] = useState("");
  return (
    <div style={{ marginTop: 12 }}>
      {!open ? (
        <div className="actions">
          <button type="button" className="btn mini" onClick={() => setOpen(true)}>+ Add a source</button>
          {!locked && attached.map((s) => <button key={s.id} type="button" className="linkbtn" style={{ fontSize: 12 }} disabled={!!busy} onClick={() => run("detach", () => api(`/api/knowledge/${itemId}/sources?sourceId=${s.id}`, { method: "DELETE" }), "Citation removed.")}>Remove “{s.title.length > 26 ? `${s.title.slice(0, 26)}…` : s.title}”</button>)}
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {available.length > 0 && (
            <div className="field">
              <label htmlFor="src-existing">Cite an existing source</label>
              <div className="actions">
                <select id="src-existing" className="select" style={{ flex: 1 }} value={existing} onChange={(e) => setExisting(e.target.value)}><option value="">Choose…</option>{available.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
                <button type="button" className="btn mini" disabled={!existing || !!busy} onClick={async () => { if (await run("attach", () => api(`/api/knowledge/${itemId}/sources`, { body: { sourceId: existing } }), "Source cited.")) { setExisting(""); setOpen(false); } }}>Cite</button>
              </div>
            </div>
          )}
          <form className="stack" style={{ gap: 10 }} noValidate onSubmit={async (event) => { event.preventDefault(); if (await run("create", () => api(`/api/knowledge/${itemId}/sources`, { body: form }), "Source added.")) { setForm({ title: "", url: "", publisher: "", sourceType: "vendor-official" }); setOpen(false); } }}>
            <div className="field"><label htmlFor="src-title">New source title</label><input id="src-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /><FieldError errors={fieldErrors.title} /></div>
            <div className="field"><label htmlFor="src-url">URL <span className="muted">(optional)</span></label><input id="src-url" type="url" className="input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" /><FieldError errors={fieldErrors.url} /></div>
            <div className="field"><label htmlFor="src-type">Source type</label><select id="src-type" className="select" value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })}>{SOURCE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
            {error && <p className="form-error" role="alert">{error.message}</p>}
            <div className="actions"><button className="btn mini primary" disabled={!!busy}>{busy === "create" ? "Adding…" : "Add source"}</button><button type="button" className="btn mini" onClick={() => setOpen(false)}>Cancel</button></div>
          </form>
        </div>
      )}
      {!open && error && <p className="form-error" role="alert" style={{ marginTop: 8 }}>{error.message}</p>}
    </div>
  );
}

export function RelationshipManager(props: { mode: "add"; itemId: string } | { mode: "remove"; itemId: string; relationshipId: string }) {
  const { run, busy, error, fieldErrors } = useAction();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<{ id: string; title: string; type: string }[]>([]);
  const [target, setTarget] = useState("");
  const [type, setType] = useState<string>("related_to");
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(async () => {
      const result = await api<{ items: { id: string; title: string; type: string }[] }>(`/api/knowledge?limit=30&sort=title${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`).catch(() => ({ items: [] }));
      setOptions(result.items.filter((i) => i.id !== props.itemId));
    }, 250);
    return () => clearTimeout(handle);
  }, [q, open, props.itemId]);

  if (props.mode === "remove") {
    return <button type="button" className="linkbtn" style={{ fontSize: 12 }} disabled={!!busy} aria-label="Remove relationship" onClick={() => run("remove", () => api(`/api/relationships/${props.relationshipId}`, { method: "DELETE" }), "Relationship removed.")}>Remove</button>;
  }
  if (!open) return <button type="button" className="btn mini" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>+ Add a relationship</button>;
  return (
    <form className="stack" style={{ gap: 10, marginTop: 10 }} noValidate onSubmit={async (event) => { event.preventDefault(); if (await run("add", () => api("/api/relationships", { body: { fromId: props.itemId, toId: target, type } }), "Relationship added.")) { setOpen(false); setTarget(""); setQ(""); } }}>
      <div className="field">
        <label htmlFor="rel-type">This item…</label>
        <select id="rel-type" className="select" value={type} onChange={(e) => setType(e.target.value)}>{RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select>
      </div>
      <div className="field">
        <label htmlFor="rel-search">Find the other item</label>
        <input id="rel-search" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search…" />
      </div>
      <div className="field">
        <label htmlFor="rel-target">Other item</label>
        <select id="rel-target" className="select" size={6} value={target} onChange={(e) => setTarget(e.target.value)}>{options.map((o) => <option key={o.id} value={o.id}>{o.title} — {o.type}</option>)}</select>
        <FieldError errors={fieldErrors.toId} />
      </div>
      {error && <p className="form-error" role="alert">{error.message}</p>}
      <div className="actions"><button className="btn mini primary" disabled={!target || !!busy}>{busy === "add" ? "Adding…" : "Add relationship"}</button><button type="button" className="btn mini" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}
