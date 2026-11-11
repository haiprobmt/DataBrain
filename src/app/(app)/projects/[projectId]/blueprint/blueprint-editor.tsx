"use client";

import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Connection, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, Dialog, downloadText, errorMessage, useAction, useUnsavedWarning } from "@/components/client";
import { Markdown } from "@/components/markdown";
import { CandidateLabel, OriginBadge, StatusBadge } from "@/components/ui";
import { NODE_KINDS, nodeKindColor } from "@/lib/catalog";
import { edgeId, newNodeId, toDrawio, toMermaid, type DiagramIssue } from "@/lib/diagram";
import { INTAKE_FIELDS } from "@/lib/intake";
import type { BlueprintSection, DiagramEdge, DiagramModel, DiagramNode } from "@/lib/types";
import { cx, formatDateTime } from "@/lib/utils";

interface RevisionView {
  id: string;
  version: number;
  status: "draft" | "approved" | "superseded";
  title: string;
  label: string;
  sections: BlueprintSection[];
  diagram: DiagramModel;
  lockVersion: number;
  contentHash: string | null;
  approvalNote: string | null;
  approvedAt: string | null;
}

type Selection = { type: "diagram" } | { type: "section"; key: string } | { type: "node"; id: string } | { type: "edge"; id: string };
type FlowNodeData = { node: DiagramNode };

function FlowNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const n = data.node;
  return (
    <div className={cx("flow-node", selected && "selected")} style={{ borderLeftColor: nodeKindColor(n.kind) }}>
      <Handle type="target" position={Position.Top} />
      <span className="kind">{n.kind}{n.provenance.origin !== "reference" ? ` · ${n.provenance.origin}` : ""}</span>
      <b>{n.label}</b>
      {n.technology && <small>{n.technology}</small>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
const nodeTypes = { component: FlowNode };
const toFlowNode = (n: DiagramNode, selectedId: string | null): Node<FlowNodeData> => ({ id: n.id, type: "component", position: n.position, data: { node: n }, selected: n.id === selectedId });

function Canvas({ diagram, editable, selection, onSelect, onMove, onConnect, onDelete }: { diagram: DiagramModel; editable: boolean; selection: Selection; onSelect: (s: Selection) => void; onMove: (id: string, position: { x: number; y: number }) => void; onConnect: (c: Connection) => void; onDelete: (nodeIds: string[], edgeIds: string[]) => void }) {
  const selectedNode = selection.type === "node" ? selection.id : null;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>(diagram.nodes.map((n) => toFlowNode(n, selectedNode)));
  const flow = useReactFlow();
  useEffect(() => {
    // Keep React Flow's measured state, refresh data and membership from the diagram model.
    setNodes((current) => diagram.nodes.map((n) => ({ ...(current.find((c) => c.id === n.id) ?? {}), ...toFlowNode(n, selectedNode) })));
  }, [diagram.nodes, selectedNode, setNodes]);
  const edges: Edge[] = useMemo(
    () =>
      diagram.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        animated: e.kind === "data" && false,
        selected: selection.type === "edge" && selection.id === e.id,
        style: { stroke: e.kind === "network" ? "#2a7f9e" : "#7a8ba6", strokeDasharray: e.kind === "control" ? "5 4" : undefined, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#7a8ba6" },
        labelStyle: { fontSize: 11, fill: "#435b82" },
      })),
    [diagram.edges, selection],
  );
  return (
    <div className="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_, node) => onMove(node.id, node.position)}
        onNodeClick={(_, node) => onSelect({ type: "node", id: node.id })}
        onEdgeClick={(_, edge) => onSelect({ type: "edge", id: edge.id })}
        onPaneClick={() => onSelect({ type: "diagram" })}
        onConnect={onConnect}
        onNodesDelete={(deleted) => onDelete(deleted.map((n) => n.id), [])}
        onEdgesDelete={(deleted) => onDelete([], deleted.map((e) => e.id))}
        nodesDraggable={editable}
        nodesConnectable={editable}
        deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: false }}
      >
        <Background color="#dfe7f1" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <button type="button" className="sr-only" onClick={() => flow.fitView()}>Fit diagram to view</button>
    </div>
  );
}

export function BlueprintEditor({ projectId, revision, issues, readOnly, canApprove, aiModel }: { projectId: string; revision: RevisionView; issues: DiagramIssue[]; readOnly: boolean; canApprove: boolean; aiModel: string | null }) {
  const router = useRouter();
  const editable = revision.status === "draft" && !readOnly;
  const [title, setTitle] = useState(revision.title);
  const [sections, setSections] = useState(revision.sections);
  const [diagram, setDiagram] = useState(revision.diagram);
  const [selection, setSelection] = useState<Selection>({ type: "diagram" });
  const [preview, setPreview] = useState(!editable);
  const [approving, setApproving] = useState(false);
  const [note, setNote] = useState("");
  const [approveError, setApproveError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<{ key: string; text: string; error: boolean } | null>(null);
  const { run, busy, error } = useAction();
  const dirty = title !== revision.title || sections !== revision.sections || diagram !== revision.diagram;
  useUnsavedWarning(dirty);

  const node = selection.type === "node" ? diagram.nodes.find((n) => n.id === selection.id) : undefined;
  const edge = selection.type === "edge" ? diagram.edges.find((e) => e.id === selection.id) : undefined;
  const section = selection.type === "section" ? sections.find((s) => s.key === selection.key) : undefined;
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const patchNode = (id: string, patch: Partial<DiagramNode>) => setDiagram((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch, provenance: n.provenance.origin === "reference" ? { ...n.provenance, origin: "adapted" as const } : n.provenance } : n)) }));
  const patchEdge = (id: string, patch: Partial<DiagramEdge>) => setDiagram((d) => ({ ...d, edges: d.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const remove = useCallback((nodeIds: string[], edgeIds: string[]) => {
    setDiagram((d) => ({ nodes: d.nodes.filter((n) => !nodeIds.includes(n.id)), edges: d.edges.filter((e) => !edgeIds.includes(e.id) && !nodeIds.includes(e.source) && !nodeIds.includes(e.target)) }));
    setSelection({ type: "diagram" });
  }, []);
  const addNode = () => {
    const id = newNodeId(diagram);
    const maxY = Math.max(0, ...diagram.nodes.map((n) => n.position.y));
    setDiagram((d) => ({ ...d, nodes: [...d.nodes, { id, kind: "other", label: "New component", description: "", config: {}, provenance: { origin: "user" }, requirementFields: [], position: { x: 40, y: maxY + 120 } }] }));
    setSelection({ type: "node", id });
  };
  const connect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const id = edgeId({ source: c.source, target: c.target });
    setDiagram((d) => (d.edges.some((e) => e.id === id) ? d : { ...d, edges: [...d.edges, { id, source: c.source!, target: c.target!, label: "", kind: "data", provenance: { origin: "user" } }] }));
    setSelection({ type: "edge", id });
  }, []);
  const move = useCallback((id: string, position: { x: number; y: number }) => setDiagram((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, position: { x: Math.round(position.x), y: Math.round(position.y) } } : n)) })), []);

  const save = () => run("save", () => api<{ lockVersion: number }>(`/api/projects/${projectId}/revisions/${revision.id}`, { method: "PUT", body: { lockVersion: revision.lockVersion, title, sections, diagram } }), "Blueprint saved.");
  const fileBase = `blueprint-v${revision.version}`;
  const draftWithAi = async (key: string) => {
    setDrafting(key);
    setDraftNote(null);
    try {
      const result = await api<{ markdown: string; model: string }>(`/api/projects/${projectId}/revisions/${revision.id}/draft-section`, { body: { key } });
      setSections((all) => all.map((s) => (s.key === key ? { ...s, body: result.markdown, origin: "generated" as const, edited: false } : s)));
      setPreview(false);
      setDraftNote({ key, error: false, text: `Draft written by ${result.model}. It is generated and not validated — review it, edit it, then save. Use “Discard changes” to go back to the saved text.` });
    } catch (e) {
      setDraftNote({ key, error: true, text: errorMessage(e) });
    } finally {
      setDrafting(null);
    }
  };

  return (
    <section className="card padding">
      <div className="pane-head">
        <div style={{ flex: 1, minWidth: 220 }}>
          {editable ? (
            <div className="field">
              <label htmlFor="bp-title">Blueprint title</label>
              <input id="bp-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          ) : (
            <h2>{revision.title}</h2>
          )}
          <p className="sub">
            Version {revision.version} · <StatusBadge status={revision.status} /> <CandidateLabel label={revision.label} />
            {revision.approvedAt && <> · approved {formatDateTime(revision.approvedAt)}</>}
          </p>
        </div>
        <div className="actions">
          {editable && (
            <>
              <button type="button" className="btn" disabled={!dirty || !!busy} onClick={save}>{busy === "save" ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
              {dirty && <button type="button" className="btn" disabled={!!busy} onClick={() => { setTitle(revision.title); setSections(revision.sections); setDiagram(revision.diagram); setSelection({ type: "diagram" }); }}>Discard changes</button>}
              {canApprove && <button type="button" className="btn primary" disabled={dirty || !!busy || errors.length > 0} title={dirty ? "Save your changes first" : errors.length ? "Fix the diagram errors first" : undefined} onClick={() => setApproving(true)}>Approve revision</button>}
            </>
          )}
          {revision.status !== "draft" && !readOnly && (
            <button
              type="button"
              className="btn primary"
              disabled={!!busy}
              onClick={async () => {
                const r = await run("clone", () => api<{ id: string }>(`/api/projects/${projectId}/revisions`, { body: { fromRevisionId: revision.id } }), "New draft revision created.");
                if (r) router.push(`?revision=${r.id}`);
              }}
            >
              {busy === "clone" ? "Creating…" : "Create new revision to edit"}
            </button>
          )}
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error.message}</p>}
      {revision.status !== "draft" && <p className="note">This revision is {revision.status} and read-only{revision.contentHash ? <> · content hash <code>{revision.contentHash.slice(0, 16)}…</code></> : null}{revision.approvalNote ? <> · note: “{revision.approvalNote}”</> : null}</p>}

      <div className="three" style={{ marginTop: 14 }}>
        <nav className="outline" aria-label="Blueprint outline">
          <button type="button" className={selection.type !== "section" ? "on" : undefined} onClick={() => setSelection({ type: "diagram" })}>Architecture diagram</button>
          {sections.map((s) => (
            <button key={s.key} type="button" className={selection.type === "section" && selection.key === s.key ? "on" : undefined} onClick={() => setSelection({ type: "section", key: s.key })}>
              {s.title}{/\bTODO\b|PLACEHOLDER/.test(s.body) ? " ●" : ""}
            </button>
          ))}
          <p className="muted" style={{ padding: "6px 9px" }}>● contains TODO or PLACEHOLDER</p>
        </nav>

        <div className="stack" style={{ gap: 10 }}>
          {section ? (
            <>
              <div className="pane-head" style={{ marginBottom: 0 }}>
                <h3>{section.title}</h3>
                <div className="actions">
                  <OriginBadge origin={section.origin} edited={section.edited} />
                  {editable && aiModel && (
                    <button type="button" className="btn mini ghost" disabled={drafting !== null} onClick={() => draftWithAi(section.key)}>
                      {drafting === section.key ? "Claude is drafting…" : "Draft with Claude"}
                    </button>
                  )}
                  {editable && <button type="button" className="btn mini" onClick={() => setPreview((p) => !p)}>{preview ? "Edit" : "Preview"}</button>}
                </div>
              </div>
              {drafting === section.key && <p className="note" role="status">Sending this project&rsquo;s requirements and components to {aiModel}. This can take up to a minute.</p>}
              {draftNote?.key === section.key && <p className={draftNote.error ? "form-error" : "note warn"} role={draftNote.error ? "alert" : "status"}>{draftNote.text}</p>}
              {editable && !preview ? (
                <div className="field">
                  <label htmlFor="section-body" className="sr-only">{section.title} (Markdown)</label>
                  <textarea id="section-body" className="textarea code" style={{ minHeight: 520 }} value={section.body} onChange={(e) => setSections((all) => all.map((s) => (s.key === section.key ? { ...s, body: e.target.value, edited: true } : s)))} />
                  <span className="hint">Markdown. Your edits are kept: later generation uses this text as written.</span>
                </div>
              ) : (
                <div style={{ minHeight: 300 }}><Markdown text={section.body || "_This section is empty._"} /></div>
              )}
            </>
          ) : (
            <>
              <div className="toolbar" style={{ margin: 0 }}>
                {editable && <button type="button" className="btn mini" onClick={addNode}>+ Add component</button>}
                <button type="button" className="btn mini" onClick={() => downloadText(`${fileBase}.mmd`, toMermaid(diagram))}>Export Mermaid</button>
                <button type="button" className="btn mini" onClick={() => downloadText(`${fileBase}.drawio`, toDrawio(diagram, title), "application/xml")}>Export draw.io</button>
                <button type="button" className="btn mini" onClick={() => downloadText(`${fileBase}.reactflow.json`, JSON.stringify(diagram, null, 2), "application/json")}>Export JSON</button>
                <span className="muted">{editable ? "Drag to move · drag from a bottom handle to a top handle to connect · Delete removes the selection" : "Read-only diagram"}</span>
              </div>
              <ReactFlowProvider>
                <Canvas diagram={diagram} editable={editable} selection={selection} onSelect={setSelection} onMove={move} onConnect={connect} onDelete={remove} />
              </ReactFlowProvider>
              <details>
                <summary className="muted" style={{ cursor: "pointer" }}>Component list ({diagram.nodes.length} components, {diagram.edges.length} connections) — keyboard alternative to the canvas</summary>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Component</th><th>Type</th><th>Technology</th><th>Provenance</th><th>Connects to</th></tr></thead>
                    <tbody>
                      {diagram.nodes.map((n) => (
                        <tr key={n.id}>
                          <td><button type="button" className="linkbtn" onClick={() => setSelection({ type: "node", id: n.id })}><strong>{n.label}</strong></button></td>
                          <td>{n.kind}</td>
                          <td>{n.technology || "—"}</td>
                          <td><OriginBadge origin={n.provenance.origin} /></td>
                          <td>{diagram.edges.filter((e) => e.source === n.id).map((e) => (<button key={e.id} type="button" className="linkbtn" style={{ marginRight: 8 }} onClick={() => setSelection({ type: "edge", id: e.id })}>{diagram.nodes.find((x) => x.id === e.target)?.label ?? e.target}</button>))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </div>

        <aside className="stack" aria-label="Properties" style={{ gap: 12 }}>
          {node ? (
            <div className="stack" style={{ gap: 10 }}>
              <div className="pane-head" style={{ marginBottom: 0 }}><h3>Component</h3><OriginBadge origin={node.provenance.origin} /></div>
              <div className="field"><label htmlFor="n-label">Label</label><input id="n-label" className="input" value={node.label} disabled={!editable} onChange={(e) => patchNode(node.id, { label: e.target.value })} /></div>
              <div className="field">
                <label htmlFor="n-kind">Type</label>
                <select id="n-kind" className="select" value={node.kind} disabled={!editable} onChange={(e) => patchNode(node.id, { kind: e.target.value as DiagramNode["kind"] })}>
                  {NODE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="n-tech">Technology</label><input id="n-tech" className="input" value={node.technology ?? ""} disabled={!editable} onChange={(e) => patchNode(node.id, { technology: e.target.value })} /></div>
              <div className="field"><label htmlFor="n-desc">Description</label><textarea id="n-desc" className="textarea" value={node.description} disabled={!editable} onChange={(e) => patchNode(node.id, { description: e.target.value })} /></div>
              <div className="field">
                <label htmlFor="n-req">Traces to requirements</label>
                <select id="n-req" className="select" multiple size={5} value={node.requirementFields} disabled={!editable} onChange={(e) => patchNode(node.id, { requirementFields: [...e.target.selectedOptions].map((o) => o.value) })}>
                  {INTAKE_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                <span className="hint">Hold Ctrl or Cmd to select several.</span>
              </div>
              <dl className="kv"><dt>ID</dt><dd><code>{node.id}</code></dd></dl>
              {editable && <button type="button" className="btn danger mini" onClick={() => remove([node.id], [])}>Delete component</button>}
            </div>
          ) : edge ? (
            <div className="stack" style={{ gap: 10 }}>
              <div className="pane-head" style={{ marginBottom: 0 }}><h3>Connection</h3><OriginBadge origin={edge.provenance.origin} /></div>
              <p className="sub">{diagram.nodes.find((n) => n.id === edge.source)?.label} → {diagram.nodes.find((n) => n.id === edge.target)?.label}</p>
              <div className="field"><label htmlFor="e-label">Label</label><input id="e-label" className="input" value={edge.label} disabled={!editable} onChange={(e) => patchEdge(edge.id, { label: e.target.value })} /></div>
              <div className="field">
                <label htmlFor="e-kind">Type</label>
                <select id="e-kind" className="select" value={edge.kind} disabled={!editable} onChange={(e) => patchEdge(edge.id, { kind: e.target.value as DiagramEdge["kind"] })}>
                  <option value="data">Data flow</option><option value="control">Control / governance</option><option value="network">Network path</option>
                </select>
              </div>
              {editable && <button type="button" className="btn danger mini" onClick={() => remove([], [edge.id])}>Delete connection</button>}
            </div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>Review checks</h3>
              <p className="sub" style={{ margin: 0 }}>Checked against the last saved version.</p>
              {issues.length === 0 && <p className="form-ok">No issues found.</p>}
              {errors.map((i, n) => <p key={`e${n}`} className="form-error">{i.message}</p>)}
              {warnings.length > 0 && (
                <div className="note warn">
                  <strong>{warnings.length} warning{warnings.length === 1 ? "" : "s"}</strong>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{warnings.slice(0, 12).map((i, n) => <li key={n}>{i.message}</li>)}</ul>
                  {warnings.length > 12 && <p style={{ margin: "4px 0 0" }}>…and {warnings.length - 12} more.</p>}
                </div>
              )}
              <p className="muted">Select a component or connection to edit its properties, or a section in the outline to edit its text.</p>
              <ul className="actions" aria-label="Component types" style={{ listStyle: "none", padding: 0, margin: 0, gap: "4px 12px" }}>{NODE_KINDS.map((k) => <li key={k.key} className="muted" style={{ display: "flex", alignItems: "center", gap: 5 }}><span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: k.color }} />{k.label}</li>)}</ul>
            </div>
          )}
        </aside>
      </div>

      {approving && (
        <Dialog title={`Approve blueprint v${revision.version}`} onClose={() => setApproving(false)}>
          <div className="prose">
            <p>Approval makes this revision immutable. Artifacts, skills and deployment plans will reference exactly this version. To change it later you create a new revision.</p>
            {warnings.length > 0 && <p><strong>{warnings.length} warning(s)</strong> remain, including unresolved TODOs or unvalidated components. You can approve with warnings; they carry into generated documents.</p>}
          </div>
          <div className="field">
            <label htmlFor="approve-note">Approval note <span className="muted">(optional)</span></label>
            <textarea id="approve-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who reviewed it, and on what basis." />
          </div>
          {approveError && <p className="form-error" role="alert">{approveError}</p>}
          <div className="actions" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" className="btn" onClick={() => setApproving(false)}>Cancel</button>
            <button
              type="button"
              className="btn primary"
              disabled={!!busy}
              onClick={async () => {
                setApproveError(null);
                try {
                  await api(`/api/projects/${projectId}/revisions/${revision.id}/approve`, { body: { lockVersion: revision.lockVersion, note } });
                  setApproving(false);
                  router.refresh();
                } catch (e) {
                  setApproveError(errorMessage(e));
                }
              }}
            >
              Approve and lock
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
