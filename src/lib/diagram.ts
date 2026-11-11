import { NODE_KINDS } from "./catalog";
import type { DiagramEdge, DiagramModel, DiagramNode } from "./types";

export interface DiagramIssue {
  severity: "error" | "warning";
  message: string;
  elementId?: string;
}

/** Structural validation used before approval and export. */
export function validateDiagram(diagram: DiagramModel): DiagramIssue[] {
  const issues: DiagramIssue[] = [];
  if (diagram.nodes.length === 0) issues.push({ severity: "error", message: "The diagram has no components." });
  const ids = new Set(diagram.nodes.map((n) => n.id));
  if (ids.size !== diagram.nodes.length) issues.push({ severity: "error", message: "Component IDs must be unique." });
  for (const edge of diagram.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) issues.push({ severity: "error", message: `Connection “${edge.label || edge.id}” points at a missing component.`, elementId: edge.id });
  }
  const connected = new Set(diagram.edges.flatMap((e) => [e.source, e.target]));
  for (const node of diagram.nodes) {
    if (!node.label.trim()) issues.push({ severity: "error", message: "A component has no label.", elementId: node.id });
    if (diagram.nodes.length > 1 && !connected.has(node.id)) issues.push({ severity: "warning", message: `“${node.label}” is not connected to anything.`, elementId: node.id });
    if (node.provenance.origin === "assumption" || node.provenance.origin === "generated") {
      issues.push({ severity: "warning", message: `“${node.label}” is ${node.provenance.origin === "assumption" ? "an assumption" : "a generated proposal"} and has not been validated.`, elementId: node.id });
    }
  }
  const dataPath = diagram.nodes.filter((n) => ["storage", "processing", "serving"].includes(n.kind));
  if (diagram.nodes.length > 0 && dataPath.length === 0) issues.push({ severity: "warning", message: "No storage, processing or serving component is defined." });
  return issues;
}

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, "_");
const esc = (text: string) => text.replace(/"/g, "'").replace(/[\[\]{}|<>]/g, " ");
const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toMermaid(diagram: DiagramModel): string {
  const lines = ["flowchart TB"];
  for (const kind of NODE_KINDS) {
    const nodes = diagram.nodes.filter((n) => n.kind === kind.key);
    if (nodes.length === 0) continue;
    lines.push(`  subgraph ${safeId(kind.key)}["${kind.label}"]`);
    for (const node of nodes) lines.push(`    ${safeId(node.id)}["${esc(node.label)}${node.technology ? `<br/>${esc(node.technology)}` : ""}"]`);
    lines.push("  end");
  }
  for (const edge of diagram.edges) {
    const arrow = edge.kind === "control" ? "-.->" : "-->";
    lines.push(`  ${safeId(edge.source)} ${arrow}${edge.label ? `|"${esc(edge.label)}"|` : ""} ${safeId(edge.target)}`);
  }
  return lines.join("\n") + "\n";
}

export function toDrawio(diagram: DiagramModel, title: string): string {
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  for (const node of diagram.nodes) {
    const color = NODE_KINDS.find((k) => k.key === node.kind)?.color ?? "#7a8ba6";
    const value = xml(node.technology ? `${node.label}\n${node.technology}` : node.label);
    cells.push(
      `<mxCell id="n_${xml(safeId(node.id))}" value="${value}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=${color};fontColor=#102650;" vertex="1" parent="1"><mxGeometry x="${Math.round(node.position.x)}" y="${Math.round(node.position.y)}" width="180" height="60" as="geometry"/></mxCell>`,
    );
  }
  for (const edge of diagram.edges) {
    cells.push(
      `<mxCell id="e_${xml(safeId(edge.id))}" value="${xml(edge.label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=#7a8ba6;${edge.kind === "control" ? "dashed=1;" : ""}" edge="1" parent="1" source="n_${xml(safeId(edge.source))}" target="n_${xml(safeId(edge.target))}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="DataBrain"><diagram name="${xml(title)}"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10"><root>${cells.join("")}</root></mxGraphModel></diagram></mxfile>\n`;
}

/** Lay nodes out top to bottom, one row per stage of the data path. Used for templates and generated proposals. */
export function autoLayout(nodes: Omit<DiagramNode, "position">[]): DiagramNode[] {
  const rows: DiagramNode["kind"][][] = [["source"], ["ingestion", "network"], ["storage", "security"], ["processing", "governance"], ["serving", "operations"], ["consumer", "other"]];
  const counters = new Map<number, number>();
  return nodes.map((node) => {
    const row = Math.max(rows.findIndex((kinds) => kinds.includes(node.kind)), 0);
    const column = counters.get(row) ?? 0;
    counters.set(row, column + 1);
    return { ...node, position: { x: 40 + column * 225, y: 40 + row * 120 } };
  });
}

export function newNodeId(diagram: DiagramModel, base = "component"): string {
  const ids = new Set(diagram.nodes.map((n) => n.id));
  for (let i = diagram.nodes.length + 1; ; i++) {
    const id = `${base}-${i}`;
    if (!ids.has(id)) return id;
  }
}

export const edgeId = (edge: Pick<DiagramEdge, "source" | "target">) => `${edge.source}__${edge.target}`;
