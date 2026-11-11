"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError, errorMessage, FieldError } from "@/components/client";
import { KNOWLEDGE_TYPES, SOURCE_TYPES } from "@/lib/catalog";

interface Result { slug: string; chunks: number; duplicates: { slug: string; title: string; similarity: number }[] }

export function ImportForm() {
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [type, setType] = useState("concept");
  const [sourceType, setSourceType] = useState("unspecified");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<Result | null>(null);

  if (result) {
    return (
      <section className="card padding stack">
        <p className="form-ok" role="status">Imported as a draft with {result.chunks} text chunk{result.chunks === 1 ? "" : "s"}. It is in the review queue and is not yet reviewed.</p>
        {result.duplicates.length > 0 && (
          <div className="note warn">
            <strong>Possible duplicates.</strong> Existing items have very similar titles:
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{result.duplicates.map((d) => <li key={d.slug}><Link href={`/knowledge/${d.slug}`}>{d.title}</Link> ({Math.round(d.similarity * 100)}% title overlap)</li>)}</ul>
          </div>
        )}
        <div className="actions">
          <Link className="btn primary" href={`/knowledge/${result.slug}`}>Review the imported item</Link>
          <button type="button" className="btn" onClick={() => { setResult(null); setFile(null); }}>Import another</button>
        </div>
      </section>
    );
  }

  return (
    <form
      className="card padding stack"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        setFieldErrors({});
        if (!file) {
          setFieldErrors({ fileName: ["Choose a .md or .txt file."] });
          return;
        }
        setBusy(true);
        try {
          setResult(await api<Result>("/api/knowledge/import", { body: { fileName: file.name, content: file.content, type, sourceType, url } }));
        } catch (e) {
          setError(errorMessage(e));
          if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="import-file">File (.md or .txt, up to 400,000 characters)</label>
        <input
          id="import-file"
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="input"
          onChange={async (event) => {
            const f = event.target.files?.[0];
            setError(null);
            if (!f) return setFile(null);
            if (f.size > 1_500_000) {
              setFile(null);
              return setFieldErrors({ fileName: ["This file is larger than 1.5 MB."] });
            }
            setFieldErrors({});
            setFile({ name: f.name, content: await f.text() });
          }}
        />
        {file && <span className="hint">{file.name} · {file.content.length.toLocaleString()} characters</span>}
        <FieldError errors={fieldErrors.fileName ?? fieldErrors.content} />
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="import-type">Knowledge type</label>
          <select id="import-type" className="select" value={type} onChange={(e) => setType(e.target.value)}>{KNOWLEDGE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
        </div>
        <div className="field">
          <label htmlFor="import-source-type">Source type</label>
          <select id="import-source-type" className="select" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>{SOURCE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="import-url">Original URL <span className="muted">(optional)</span></label>
        <input id="import-url" className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        <FieldError errors={fieldErrors.url} />
      </div>
      <p className="note">Imported text is stored as data. It is never executed or followed as instructions.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn primary" disabled={busy}>{busy ? "Importing…" : "Import to review queue"}</button>
        <Link href="/knowledge" className="btn">Cancel</Link>
      </div>
    </form>
  );
}
