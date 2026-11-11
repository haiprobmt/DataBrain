"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, FieldError, useAction } from "@/components/client";
import { Badge, CandidateLabel, DemoTag, EmptyState, ScoreBar, SourceCitation, TrustBadge, type CitationSource } from "@/components/ui";
import { DEFAULT_WEIGHTS, FACTOR_LABELS, knowledgeTypeLabel } from "@/lib/catalog";
import { FACTOR_KEYS, type CandidateFactor, type FinderWeights } from "@/lib/types";
import { formatDateTime, pct } from "@/lib/utils";

interface CandidateView {
  id: string;
  rank: number;
  title: string;
  summary: string;
  label: string;
  score: number;
  confidence: number;
  factors: CandidateFactor[];
  gaps: string[];
  tradeoffs: string[];
  assumptions: string[];
  costDrivers: string[];
  matchReasons: string[];
  generator: string;
  weights: FinderWeights;
  scenario: { slug: string; status: string; isDemo: boolean } | null;
  related: { slug: string; title: string; type: string; status: string }[];
  sources: CitationSource[];
  revisionVersion: number | null;
}

interface Props {
  projectId: string;
  requirementsApproved: boolean;
  readOnly: boolean;
  weights: FinderWeights;
  run: number;
  latestRun: number;
  ranAt: string | null;
  excluded: { id: string; title: string; reason: string }[];
  candidates: CandidateView[];
}

const List = ({ items, empty }: { items: string[]; empty: string }) => (items.length ? <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{items.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="muted" style={{ margin: "4px 0 0" }}>{empty}</p>);

export function FinderPanel(props: Props) {
  const router = useRouter();
  const { run, busy, error, fieldErrors } = useAction();
  const [weights, setWeights] = useState<FinderWeights>(props.weights);
  const [showWeights, setShowWeights] = useState(false);
  // Until the user chooses, the top candidate is expanded so its score is never shown unexplained.
  const [chosen, setOpen] = useState<string | null | undefined>(undefined);
  const open = chosen === undefined ? (props.candidates[0]?.id ?? null) : chosen;
  const [compare, setCompare] = useState<string[]>([]);
  const total = FACTOR_KEYS.reduce((sum, key) => sum + (weights[key] || 0), 0);
  const compared = props.candidates.filter((c) => compare.includes(c.id));
  const runFinder = () => run("finder", () => api(`/api/projects/${props.projectId}/finder`, { body: { weights } }), "Finder run complete.").then((r) => r && router.replace(`/projects/${props.projectId}#candidates`));

  return (
    <div className="stack">
      {!props.requirementsApproved && <div className="note warn">Approve the requirements above to run the Finder. Ranking always uses requirements a person has reviewed.</div>}
      <div className="actions">
        {!props.readOnly && (
          <button type="button" className="btn primary" disabled={!props.requirementsApproved || !!busy || total <= 0} onClick={runFinder}>
            {busy === "finder" ? "Ranking…" : props.run ? "Run Finder again" : "Find architectures"}
          </button>
        )}
        <button type="button" className="btn" aria-expanded={showWeights} onClick={() => setShowWeights((v) => !v)}>
          {showWeights ? "Hide scoring weights" : "Show scoring weights"}
        </button>
        {props.run > 0 && (
          <span className="muted">
            Run {props.run} of {props.latestRun}{props.ranAt ? ` · ${formatDateTime(props.ranAt)}` : ""}
            {props.run > 1 && <> · <Link href={`?run=${props.run - 1}#candidates`}>previous run</Link></>}
            {props.run < props.latestRun && <> · <Link href={`?run=${props.run + 1}#candidates`}>next run</Link></>}
          </span>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error.message}</p>}

      {showWeights && (
        <div className="card padding" style={{ boxShadow: "none" }}>
          <p className="sub" style={{ marginTop: 0 }}>Weights say how much each factor counts. They are normalised to 100% when the Finder runs. A score is a decision aid, not a fact.</p>
          <div className="form-grid">
            {FACTOR_KEYS.map((key) => (
              <div className="field" key={key}>
                <label htmlFor={`w-${key}`}>{FACTOR_LABELS[key].label} — {total > 0 ? pct((weights[key] || 0) / total) : "0%"}</label>
                <input id={`w-${key}`} type="range" min={0} max={50} step={5} value={weights[key]} disabled={props.readOnly} onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) })} style={{ accentColor: "var(--orange)" }} />
                <span className="hint">{FACTOR_LABELS[key].help}</span>
              </div>
            ))}
          </div>
          <FieldError errors={fieldErrors.weights} />
          {total <= 0 && <p className="form-error">At least one weight must be above zero.</p>}
          {!props.readOnly && <button type="button" className="btn mini" style={{ marginTop: 10 }} onClick={() => setWeights(DEFAULT_WEIGHTS)}>Reset to defaults</button>}
        </div>
      )}

      {props.run === 0 ? (
        <EmptyState title="No candidates yet">Once the requirements are approved, the Finder ranks the scenarios in your knowledge base and shows the factor breakdown, gaps, trade-offs and sources for each.</EmptyState>
      ) : (
        <>
          <div className="stack" style={{ gap: 12 }}>
            {props.candidates.map((c) => {
              const expanded = open === c.id;
              return (
                <article key={c.id} className="card padding" style={{ boxShadow: "none", borderColor: expanded ? "#f6c791" : undefined }}>
                  <div className="pane-head" style={{ marginBottom: 8 }}>
                    <h3 style={{ fontSize: 15 }}>
                      {c.rank}. {c.title} {c.scenario?.isDemo && <DemoTag />}
                    </h3>
                    <div className="actions">
                      <CandidateLabel label={c.label} />
                      {c.scenario && <TrustBadge status={c.scenario.status} />}
                    </div>
                  </div>
                  <p className="sub" style={{ margin: "0 0 12px", maxWidth: "95ch" }}>{c.summary}</p>
                  <div className="form-grid" style={{ alignItems: "end" }}>
                    <div>
                      <div className="actions" style={{ justifyContent: "space-between" }}><strong>Fit score</strong><strong>{pct(c.score)}</strong></div>
                      <ScoreBar value={c.score} label="Fit score" />
                    </div>
                    <div>
                      <div className="actions" style={{ justifyContent: "space-between" }}><strong>Confidence</strong><strong>{pct(c.confidence)}</strong></div>
                      <ScoreBar value={c.confidence} tone="blue" label="Confidence" />
                    </div>
                  </div>
                  {c.factors.length > 0 && (
                    <p className="muted" style={{ margin: "10px 0 0" }}>
                      {c.matchReasons[0] ?? "No match evidence"} · {c.gaps.length} gap{c.gaps.length === 1 ? "" : "s"} · {c.factors.filter((f) => !f.known).length} of {c.factors.length} factors scored on unknown inputs
                    </p>
                  )}
                  <div className="actions" style={{ marginTop: 12 }}>
                    <button type="button" className="btn mini" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : c.id)}>{expanded ? "Hide breakdown" : "Show breakdown, gaps and sources"}</button>
                    <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={compare.includes(c.id)} onChange={(e) => setCompare(e.target.checked ? [...compare, c.id] : compare.filter((id) => id !== c.id))} /> Compare
                    </label>
                    {c.revisionVersion ? (
                      <Link className="btn mini ghost" href={`/projects/${props.projectId}/blueprint`}>Blueprint v{c.revisionVersion} uses this</Link>
                    ) : (
                      !props.readOnly && (
                        <button
                          type="button"
                          className="btn mini primary"
                          disabled={!!busy}
                          onClick={async () => {
                            const r = await run(`bp-${c.id}`, () => api<{ id: string }>(`/api/projects/${props.projectId}/revisions`, { body: { candidateId: c.id } }));
                            if (r) router.push(`/projects/${props.projectId}/blueprint?revision=${r.id}`);
                          }}
                        >
                          {busy === `bp-${c.id}` ? "Creating…" : "Create blueprint from this"}
                        </button>
                      )
                    )}
                  </div>

                  {expanded && (
                    <div className="stack" style={{ marginTop: 16 }}>
                      {c.factors.length > 0 ? (
                        <div className="table-wrap">
                          <table className="table">
                            <caption className="sr-only">Factor breakdown for {c.title}</caption>
                            <thead><tr><th>Factor</th><th>Weight</th><th style={{ width: 150 }}>Score</th><th>Evidence</th><th>Gaps</th></tr></thead>
                            <tbody>
                              {c.factors.map((f) => (
                                <tr key={f.key}>
                                  <td><strong>{f.label}</strong></td>
                                  <td>{pct(f.weight)}</td>
                                  <td>
                                    {pct(f.score)} {!f.known && <Badge tone="warn" title="Inputs unknown: scored a neutral 50% and counted against confidence.">Unknown</Badge>}
                                    <ScoreBar value={f.score} tone={f.known ? "orange" : "grey"} label={f.label} />
                                  </td>
                                  <td>{f.evidence.length ? f.evidence.map((e, i) => <div key={i}>{e}</div>) : <span className="muted">No evidence</span>}</td>
                                  <td>{f.gaps.length ? f.gaps.map((g, i) => <div key={i}>{g}</div>) : <span className="muted">None</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="note warn">This outline was not scored: it is not based on a stored scenario.</p>
                      )}
                      <div className="form-grid">
                        <div><strong>Why it matched</strong><List items={c.matchReasons} empty="No match evidence." /></div>
                        <div><strong>Gaps to close</strong><List items={c.gaps} empty="None identified." /></div>
                        <div><strong>Trade-offs and limitations</strong><List items={c.tradeoffs} empty="None recorded on the scenario." /></div>
                        <div><strong>Assumptions</strong><List items={c.assumptions} empty="None." /></div>
                        <div><strong>Cost drivers</strong> <span className="muted">(no prices are estimated)</span><List items={c.costDrivers} empty="None recorded on the scenario." /></div>
                        <div>
                          <strong>Connected knowledge</strong>
                          {c.related.length ? (
                            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                              {c.scenario && <li><Link href={`/knowledge/${c.scenario.slug}`}>Reference scenario</Link></li>}
                              {c.related.map((r) => <li key={r.slug}><Link href={`/knowledge/${r.slug}`}>{r.title}</Link> <span className="muted">· {knowledgeTypeLabel(r.type)} · {r.status}</span></li>)}
                            </ul>
                          ) : <p className="muted" style={{ margin: "4px 0 0" }}>None.</p>}
                        </div>
                      </div>
                      <div>
                        <strong>Sources cited by this knowledge</strong>
                        {c.sources.length ? c.sources.map((s) => <SourceCitation key={s.id} source={s} />) : <p className="muted">No sources.</p>}
                      </div>
                      <p className="muted">Scored by {c.generator}.</p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {compared.length >= 2 && (
            <div>
              <h3 className="sectiontitle" style={{ fontSize: 15, marginBottom: 8 }}>Comparison</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Factor</th>{compared.map((c) => <th key={c.id}>{c.title}</th>)}</tr></thead>
                  <tbody>
                    <tr><td><strong>Label</strong></td>{compared.map((c) => <td key={c.id}><CandidateLabel label={c.label} /></td>)}</tr>
                    <tr><td><strong>Fit score</strong></td>{compared.map((c) => <td key={c.id}><strong>{pct(c.score)}</strong></td>)}</tr>
                    <tr><td><strong>Confidence</strong></td>{compared.map((c) => <td key={c.id}>{pct(c.confidence)}</td>)}</tr>
                    {FACTOR_KEYS.map((key) => (
                      <tr key={key}>
                        <td><strong>{FACTOR_LABELS[key].label}</strong></td>
                        {compared.map((c) => {
                          const f = c.factors.find((x) => x.key === key);
                          return <td key={c.id}>{f ? <>{pct(f.score)}{!f.known && " (unknown)"}<div className="muted">{f.gaps[0] ?? f.evidence[0] ?? ""}</div></> : "—"}</td>;
                        })}
                      </tr>
                    ))}
                    <tr><td><strong>Open gaps</strong></td>{compared.map((c) => <td key={c.id}>{c.gaps.length}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {compared.length === 1 && <p className="muted">Tick “Compare” on a second candidate to see them side by side.</p>}

          {props.excluded.length > 0 && (
            <details>
              <summary className="muted" style={{ cursor: "pointer" }}>{props.excluded.length} scenario{props.excluded.length === 1 ? "" : "s"} filtered out by hard constraints</summary>
              <ul style={{ fontSize: 12.5, color: "#435b82" }}>{props.excluded.map((e) => <li key={e.id}><strong>{e.title}:</strong> {e.reason}</li>)}</ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
