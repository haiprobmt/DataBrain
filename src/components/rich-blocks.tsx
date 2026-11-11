"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Code2, Copy, Download, Maximize2, Workflow, X } from "lucide-react";

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return { copied, copy };
}

/** A fenced code block with its language label and a copy button. */
export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { copied, copy } = useCopy(code);
  return (
    <figure className="codeblock">
      <figcaption>
        <span>{language || "text"}</span>
        <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy code"}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
    </figure>
  );
}

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
/** Load and configure Mermaid once, in the browser only, with the brand palette. */
function loadMermaid() {
  mermaidReady ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      // Diagram text can come from imported documents or a model: no scripts, no click handlers, no raw HTML.
      securityLevel: "strict",
      theme: "base",
      fontFamily: "Inter, 'Segoe UI', Arial, sans-serif",
      themeVariables: {
        fontSize: "13px",
        primaryColor: "#ffffff",
        primaryTextColor: "#102650",
        primaryBorderColor: "#3074cc",
        secondaryColor: "#fff5e8",
        tertiaryColor: "#f7fafc",
        lineColor: "#5f7190",
        textColor: "#263859",
        mainBkg: "#ffffff",
        nodeBorder: "#3074cc",
        clusterBkg: "#f7fafc",
        clusterBorder: "#cfdcec",
        titleColor: "#102650",
        edgeLabelBackground: "#ffffff",
        noteBkgColor: "#fff5e8",
        noteBorderColor: "#f9dbb4",
        actorBorder: "#3074cc",
        actorBkg: "#ffffff",
      },
      flowchart: { curve: "basis", padding: 14, useMaxWidth: true, subGraphTitleMargin: { top: 6, bottom: 12 } },
    });
    return mermaid;
  });
  return mermaidReady;
}

/** Renders Mermaid source as a diagram, with the source one click away and a clear message if it cannot be drawn. */
export function MermaidDiagram({ code, title = "Diagram" }: { code: string; title?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"diagram" | "code">("diagram");
  const [large, setLarge] = useState(false);
  const { copied, copy } = useCopy(code);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = await loadMermaid();
        await mermaid.parse(code);
        const result = await mermaid.render(`mmd${id}`, code);
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
        }
      } catch (e) {
        // Mermaid leaves an error graphic in the page when rendering fails; remove it.
        document.getElementById(`dmmd${id}`)?.remove();
        if (!cancelled) {
          setSvg(null);
          setError(e instanceof Error ? (e.message.split("\n")[0] ?? "Invalid diagram") : "Invalid diagram");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  useEffect(() => {
    if (!large) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setLarge(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [large]);

  const download = () => {
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "diagram"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const showCode = view === "code" || !!error;

  return (
    <figure className="diagram">
      <figcaption>
        <span className="diagram-title"><Workflow aria-hidden />{title}</span>
        <div className="diagram-tools">
          <div role="group" aria-label="View">
            <button type="button" aria-pressed={!showCode} disabled={!!error} onClick={() => setView("diagram")}><Workflow aria-hidden />Diagram</button>
            <button type="button" aria-pressed={showCode} onClick={() => setView("code")}><Code2 aria-hidden />Code</button>
          </div>
          <button type="button" onClick={copy}>{copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? "Copied" : "Copy code"}</button>
          <button type="button" onClick={download} disabled={!svg}><Download aria-hidden />SVG</button>
          <button type="button" onClick={() => setLarge(true)} disabled={!svg}><Maximize2 aria-hidden />Enlarge</button>
        </div>
      </figcaption>
      {error && <p className="form-error" role="alert" style={{ margin: 12 }}>This diagram could not be drawn ({error}). Its source is shown instead.</p>}
      {showCode ? (
        <pre tabIndex={0}><code>{code}</code></pre>
      ) : svg ? (
        <div className="diagram-canvas" role="img" aria-label={`${title}. Switch to Code for the text version.`} dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="skeleton" style={{ height: 220, margin: 12 }} aria-busy="true" aria-label="Drawing diagram" />
      )}
      {large && svg && (
        <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setLarge(false)}>
          <div className="dialog diagram-large" role="dialog" aria-modal="true" aria-label={title}>
            <div className="pane-head">
              <h2>{title}</h2>
              <button type="button" className="btn mini" ref={closeRef} onClick={() => setLarge(false)}><X aria-hidden />Close</button>
            </div>
            <div className="diagram-canvas" role="img" aria-label={title} dangerouslySetInnerHTML={{ __html: svg.replace(`mmd${id}`, `mmd${id}L`) }} />
          </div>
        </div>
      )}
    </figure>
  );
}
