"use client";

import type { Core } from "cytoscape";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/components/client";
import { DemoTag, EmptyState, TrustBadge } from "@/components/ui";
import { KNOWLEDGE_TYPES, knowledgeTypeLabel, TYPE_COLORS } from "@/lib/catalog";

interface GraphNode { id: string; slug: string; title: string; type: string; status: string; summary: string; isDemo: boolean; degree: number }
interface GraphEdge { id: string; fromId: string; toId: string; type: string }
interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean }

export function GraphExplorer({ initialFocus }: { initialFocus: string | null }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [focus, setFocus] = useState<string | null>(initialFocus);
  const [depth, setDepth] = useState(1);
  const [selected, setSelected] = useState<string | null>(initialFocus);
  const [view, setView] = useState<"graph" | "list">("graph");
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      const sp = new URLSearchParams();
      if (focus) {
        sp.set("focus", focus);
        sp.set("depth", String(depth));
      } else {
        if (q.trim()) sp.set("q", q.trim());
        if (types.length) sp.set("types", types.join(","));
        if (status) sp.set("status", status);
      }
      try {
        const result = await api<GraphData>(`/api/graph?${sp.toString()}`);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, types, status, focus, depth]);

  useEffect(() => {
    if (view !== "graph" || !data || !container.current) return;
    let disposed = false;
    void import("cytoscape").then(({ default: cytoscape }) => {
      if (disposed || !container.current) return;
      cy.current?.destroy();
      const instance = cytoscape({
        container: container.current,
        elements: [
          ...data.nodes.map((n) => ({ data: { id: n.id, label: n.title, color: TYPE_COLORS[n.type] ?? "#7a8ba6", size: 22 + Math.min(n.degree, 10) * 3, draft: n.status === "draft" ? 1 : 0 } })),
          ...data.edges.map((e) => ({ data: { id: e.id, source: e.fromId, target: e.toId, label: e.type.replace(/_/g, " ") } })),
        ],
        style: [
          { selector: "node", style: { "background-color": "data(color)", label: "data(label)", width: "data(size)", height: "data(size)", "font-size": 11, color: "#263859", "text-wrap": "wrap", "text-max-width": "110px", "text-valign": "bottom", "text-margin-y": 5, "border-width": 2, "border-color": "#fff" } },
          { selector: "node[draft = 1]", style: { "border-style": "dashed", "border-color": "#a9b8cf" } },
          { selector: "node:selected", style: { "border-color": "#f28a00", "border-width": 4, "border-style": "solid" } },
          { selector: "edge", style: { width: 1.2, "line-color": "#c8d4e3", "target-arrow-color": "#c8d4e3", "target-arrow-shape": "triangle", "curve-style": "bezier", "font-size": 9, color: "#435b82", "text-rotation": "autorotate", "text-background-color": "#fbfcfe", "text-background-opacity": 1, "text-background-padding": "2px" } },
          { selector: "edge.near", style: { label: "data(label)", "line-color": "#f28a00", "target-arrow-color": "#f28a00", width: 2 } },
          { selector: "node.far", style: { opacity: 0.35 } },
        ],
        layout: { name: "cose", animate: false, nodeRepulsion: () => 90000, idealEdgeLength: () => 85, nodeOverlap: 30, componentSpacing: 40, gravity: 1.2, numIter: 2500, padding: 30 },
        minZoom: 0.2,
        maxZoom: 2.5,
        wheelSensitivity: 0.3,
      });
      instance.on("tap", "node", (event) => setSelected(event.target.id()));
      instance.on("tap", (event) => {
        if (event.target === instance) setSelected(null);
      });
      cy.current = instance;
    });
    return () => {
      disposed = true;
      cy.current?.destroy();
      cy.current = null;
    };
  }, [data, view]);

  useEffect(() => {
    const instance = cy.current;
    if (!instance) return;
    instance.nodes().unselect();
    instance.elements().removeClass("near far");
    if (selected) {
      const target = instance.getElementById(selected);
      target.select();
      // Label and highlight only the selected node's relationships, so the full graph stays readable.
      target.connectedEdges().addClass("near");
      instance.nodes().not(target.closedNeighborhood()).addClass("far");
    }
  }, [selected, data]);

  const node = data?.nodes.find((n) => n.id === selected) ?? null;
  const neighbours = node && data ? data.edges.filter((e) => e.fromId === node.id || e.toId === node.id).map((e) => ({ edge: e, other: data.nodes.find((n) => n.id === (e.fromId === node.id ? e.toId : e.fromId)), out: e.fromId === node.id })) : [];
  const usedTypes = data ? KNOWLEDGE_TYPES.filter((t) => data.nodes.some((n) => n.type === t.key)) : [];

  return (
    <div className="gridtwo" style={{ ["--cols" as string]: "minmax(0, 1.5fr) minmax(280px, 0.5fr)" }}>
      <section className="card padding">
        <div className="toolbar">
          <label className="sr-only" htmlFor="g-q">Search the graph</label>
          <input id="g-q" type="search" className="input" value={q} disabled={!!focus} onChange={(e) => setQ(e.target.value)} placeholder="Search nodes…" />
          <label className="sr-only" htmlFor="g-type">Type</label>
          <select id="g-type" className="select" value={types[0] ?? ""} disabled={!!focus} onChange={(e) => setTypes(e.target.value ? [e.target.value] : [])}>
            <option value="">All types</option>
            {KNOWLEDGE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <label className="sr-only" htmlFor="g-status">Review status</label>
          <select id="g-status" className="select" value={status} disabled={!!focus} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option><option value="draft">Draft</option><option value="reviewed">Reviewed</option><option value="verified">Verified</option>
          </select>
          <div className="actions" role="group" aria-label="View">
            <button type="button" className="btn mini" aria-pressed={view === "graph"} onClick={() => setView("graph")}>Graph</button>
            <button type="button" className="btn mini" aria-pressed={view === "list"} onClick={() => setView("list")}>List</button>
          </div>
        </div>
        {focus && (
          <div className="note" style={{ marginBottom: 12 }}>
            Showing the neighbourhood of <strong>{data?.nodes.find((n) => n.id === focus)?.title ?? "the selected item"}</strong>.{" "}
            <label htmlFor="g-depth">Depth</label>{" "}
            <select id="g-depth" value={depth} onChange={(e) => setDepth(Number(e.target.value))}><option value={1}>1 step</option><option value={2}>2 steps</option><option value={3}>3 steps</option></select>{" "}
            <button type="button" className="linkbtn" onClick={() => setFocus(null)}>Show the whole graph</button>
          </div>
        )}
        {error ? (
          <p className="form-error" role="alert">{error}</p>
        ) : !data ? (
          <div className="skeleton" style={{ height: 560 }} aria-busy="true" />
        ) : data.nodes.length === 0 ? (
          <EmptyState title="Nothing to show">No knowledge items match these filters. Clear them, or add items and relationships in the Knowledge Library.</EmptyState>
        ) : view === "graph" ? (
          <>
            <div ref={container} className="canvas" role="img" aria-label={`Knowledge graph with ${data.nodes.length} nodes and ${data.edges.length} relationships. Use the List view for a keyboard-accessible alternative.`} />
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="button" className="btn mini" onClick={() => cy.current?.fit(undefined, 30)}>Fit</button>
              <button type="button" className="btn mini" onClick={() => cy.current?.zoom({ level: (cy.current.zoom() ?? 1) * 1.25, renderedPosition: { x: (cy.current.width() ?? 0) / 2, y: (cy.current.height() ?? 0) / 2 } })}>Zoom in</button>
              <button type="button" className="btn mini" onClick={() => cy.current?.zoom({ level: (cy.current.zoom() ?? 1) / 1.25, renderedPosition: { x: (cy.current.width() ?? 0) / 2, y: (cy.current.height() ?? 0) / 2 } })}>Zoom out</button>
              <span className="muted">{data.nodes.length} nodes · {data.edges.length} relationships{data.truncated ? " · showing the first 150 — filter or focus to see the rest" : ""}</span>
            </div>
            <ul className="actions" style={{ listStyle: "none", padding: 0, margin: "10px 0 0", gap: "4px 14px" }} aria-label="Legend">
              {usedTypes.map((t) => <li key={t.key} className="muted" style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: TYPE_COLORS[t.key] }} />{t.label}</li>)}
              <li className="muted" style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: "50%", border: "2px dashed #a9b8cf" }} />Draft (dashed outline)</li>
            </ul>
          </>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 640, overflowY: "auto" }}>
            <table className="table">
              <thead><tr><th>Item</th><th>Type</th><th>Status</th><th>Links</th></tr></thead>
              <tbody>
                {data.nodes.map((n) => (
                  <tr key={n.id} aria-selected={selected === n.id} style={selected === n.id ? { background: "#fff8ef" } : undefined}>
                    <td><button type="button" className="linkbtn" onClick={() => setSelected(n.id)}><strong>{n.title}</strong></button></td>
                    <td>{knowledgeTypeLabel(n.type)}</td>
                    <td>{n.status}</td>
                    <td>{n.degree}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <aside className="card padding" aria-live="polite">
        {!node ? (
          <EmptyState title="Select a node">Click a node in the graph, or choose an item in the list view, to see what it is and what it connects to.</EmptyState>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 17, margin: 0 }}>{node.title}</h2>
              <p className="sub">{knowledgeTypeLabel(node.type)}</p>
              <div className="actions" style={{ marginTop: 8 }}><TrustBadge status={node.status} />{node.isDemo && <DemoTag />}</div>
            </div>
            <p style={{ margin: 0, color: "#3b557d", fontSize: 13 }}>{node.summary}</p>
            <div className="actions">
              <Link className="btn mini primary" href={`/knowledge/${node.slug}`}>Open article</Link>
              {focus !== node.id && <button type="button" className="btn mini" onClick={() => { setFocus(node.id); setDepth(1); }}>Focus on neighbourhood</button>}
            </div>
            <div>
              <strong>Connections ({neighbours.length})</strong>
              {neighbours.length === 0 && <p className="muted">None in the current view.</p>}
              {neighbours.map(({ edge, other, out }) => other && (
                <div key={edge.id} className="checkrow"><div><span>{out ? edge.type.replace(/_/g, " ") : `${edge.type.replace(/_/g, " ")} (incoming)`}</span><strong><button type="button" className="linkbtn" onClick={() => setSelected(other.id)}>{other.title}</button></strong></div></div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
