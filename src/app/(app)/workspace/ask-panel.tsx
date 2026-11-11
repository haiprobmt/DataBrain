"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError, errorMessage } from "@/components/client";
import { DemoTag, EmptyState, SourceCitation, TrustBadge } from "@/components/ui";
import { knowledgeTypeLabel } from "@/lib/catalog";

interface Passage {
  item: { id: string; slug: string; title: string; type: string; status: string; isDemo: boolean };
  passage: string;
  why: string[];
  sources: { id: string; title: string; url: string | null; sourceType: string }[];
}
interface Exchange { question: string; passages: Passage[] }

const SUGGESTIONS = ["How does the medallion architecture work?", "What are the trade-offs of private endpoints?", "How should I reconcile a data migration?"];

export function AskPanel({ generative, provider }: { generative: boolean; provider: string }) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ passages: Passage[] }>("/api/ask", { body: { question: text } });
      setHistory((h) => [{ question: text, passages: result.passages }, ...h]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof ApiError && e.fieldErrors.question ? e.fieldErrors.question.join(" ") : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      {!generative && (
        <p className="note">
          <strong>Retrieval only.</strong> No generative model is configured (provider: {provider}), so nothing here is written by an AI. You get the stored passages that best match your question, exactly as they are in the Knowledge Library.
        </p>
      )}
      <section className="card padding">
        <form className="stack" style={{ gap: 10 }} onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
          <div className="field">
            <label htmlFor="ask-q">Your question</label>
            <textarea id="ask-q" className="textarea" style={{ minHeight: 70 }} value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void ask(question); }} placeholder="e.g. What should I validate after deploying a lakehouse?" />
          </div>
          <div className="actions">
            <button className="btn primary" disabled={busy || question.trim().length < 3}>{busy ? "Searching…" : "Ask"}</button>
            {SUGGESTIONS.map((s) => <button key={s} type="button" className="btn mini" disabled={busy} onClick={() => ask(s)}>{s}</button>)}
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
      </section>
      <div aria-live="polite" className="stack">
        {history.length === 0 && !busy && <section className="card padding"><EmptyState title="Ask something">Try one of the suggested questions, or ask about a platform, pattern or practice in your library.</EmptyState></section>}
        {history.map((exchange, n) => (
          <section className="card padding" key={history.length - n}>
            <h2 className="sectiontitle" style={{ fontSize: 15 }}>{exchange.question}</h2>
            {exchange.passages.length === 0 ? (
              <p className="note warn" style={{ marginTop: 12 }}>Nothing in the knowledge base matches this question. DataBrain will not make up an answer — add or import knowledge on this topic.</p>
            ) : (
              exchange.passages.map((p) => (
                <article key={p.item.id} style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 12 }}>
                  <div className="actions" style={{ marginBottom: 6 }}>
                    <Link href={`/knowledge/${p.item.slug}`}><strong>{p.item.title}</strong></Link>
                    <span className="muted">{knowledgeTypeLabel(p.item.type)}</span>
                    <TrustBadge status={p.item.status} />
                    {p.item.isDemo && <DemoTag />}
                  </div>
                  <blockquote style={{ margin: 0, padding: "8px 14px", borderLeft: "3px solid var(--orange)", background: "#fffaf3", borderRadius: "0 10px 10px 0", color: "#263859" }}>{p.passage}</blockquote>
                  <p className="muted" style={{ margin: "6px 0 0" }}>Matched because: {p.why.join(" · ")}</p>
                  {p.sources.length ? p.sources.map((s) => <SourceCitation key={s.id} source={s} />) : <p className="muted">This item cites no sources.</p>}
                </article>
              ))
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
