import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { Badge, Card, DemoTag, PageHeader, SourceCitation, TrustBadge, VersionHistory } from "@/components/ui";
import { knowledgeTypeLabel, sourceTypeLabel, TRUST_LABELS } from "@/lib/catalog";
import { formatDate, formatDateTime } from "@/lib/utils";
import { tokenLabel } from "@/lib/vocab";
import { requireCtx } from "@/server/auth";
import { getItemDetail, listSources } from "@/server/services/knowledge";
import { RelationshipManager, SourceManager, StatusActions } from "./item-actions";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return { title: decodeURIComponent((await params).slug).replace(/-/g, " ") };
}

const ORIGIN_TEXT: Record<string, string> = { human: "Written in DataBrain", imported: "Imported from a document", generated: "Generated", "demo-seed": "Demo seed content" };

export default async function KnowledgeItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireCtx();
  const { slug } = await params;
  const detail = await getItemDetail(ctx, slug).catch(() => null);
  if (!detail) notFound();
  const { item, sources, related, versions } = detail;
  const allSources = ctx.role === "viewer" ? [] : await listSources(ctx);
  const a = item.attributes;
  const canEdit = ctx.role !== "viewer";
  const tokens = (list?: string[]) => (list?.length ? list.map(tokenLabel).join(", ") : "Not recorded");
  const grouped = new Map<string, typeof related>();
  for (const r of related) grouped.set(`${r.direction}:${r.type}`, [...(grouped.get(`${r.direction}:${r.type}`) ?? []), r]);

  return (
    <>
      <PageHeader
        title={item.title}
        description={<>{knowledgeTypeLabel(item.type)} · version {item.version} · updated {formatDate(item.updatedAt)}</>}
        actions={
          <>
            <Link href={`/graph?focus=${item.id}`} className="btn">View in graph</Link>
            {canEdit && <Link href={`/knowledge/${item.slug}/edit`} className="btn">Edit</Link>}
          </>
        }
      />
      <div className="cols">
        <div className="stack">
          <Card>
            <div className="actions" style={{ marginBottom: 12 }}>
              <TrustBadge status={item.status} lastVerifiedAt={item.lastVerifiedAt} policyDays={detail.freshnessPolicyDays} />
              {item.isDemo && <DemoTag />}
              {item.tags.map((t) => <span key={t} className="tag">{t}</span>)}
            </div>
            {item.isDemo && item.status === "draft" && <p className="note warn" style={{ marginBottom: 12 }}>Demo seed content written from general platform knowledge. It has not been checked against the sources listed. Review it before relying on it.</p>}
            <p style={{ fontSize: 14, color: "#263859", margin: 0 }}>{item.summary}</p>
          </Card>
          {item.sections.map((s) => (
            <Card key={s.key} title={s.title}><Markdown text={s.body} /></Card>
          ))}
          {item.type === "scenario" && (
            <Card title="Matching attributes" aside={<span className="muted">Used by the Architecture Finder</span>}>
              <dl className="kv">
                <dt>Platforms</dt><dd>{tokens(a.platforms)}</dd>
                <dt>Clouds</dt><dd>{tokens(a.clouds)}</dd>
                <dt>Workloads</dt><dd>{tokens(a.workloads)}</dd>
                <dt>Latency</dt><dd>{tokens(a.latency)}</dd>
                <dt>Source systems</dt><dd>{tokens(a.sourceSystems)}</dd>
                <dt>Security / network</dt><dd>{tokens(a.security)}</dd>
                <dt>Skills needed</dt><dd>{tokens(a.skills)}</dd>
                <dt>Complexity</dt><dd>{a.complexity ? `${a.complexity} of 5 (author's judgement)` : "Not recorded"}</dd>
                <dt>Migration effort</dt><dd>{a.migrationEffort ? `${a.migrationEffort} of 5 (author's judgement)` : "Not recorded"}</dd>
                <dt>Billing model</dt><dd>{a.costModel ?? "Not recorded"}</dd>
              </dl>
              {(["costDrivers", "tradeoffs", "limitations", "steps"] as const).map((key) => a[key]?.length ? (
                <div key={key} style={{ marginTop: 12 }}>
                  <strong>{{ costDrivers: "Cost drivers (no prices)", tradeoffs: "Trade-offs", limitations: "Limitations", steps: "Delivery steps" }[key]}</strong>
                  {key === "steps" ? <ol style={{ margin: "4px 0 0", paddingLeft: 20 }}>{a[key]!.map((v, i) => <li key={i}>{v}</li>)}</ol> : <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>{a[key]!.map((v, i) => <li key={i}>{v}</li>)}</ul>}
                </div>
              ) : null)}
              {a.diagram && (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer" }}><strong>Reference architecture</strong> — {a.diagram.nodes.length} components, {a.diagram.edges.length} connections</summary>
                  <div className="table-wrap"><table className="table"><thead><tr><th>Component</th><th>Type</th><th>Technology</th><th>Purpose</th></tr></thead><tbody>{a.diagram.nodes.map((n) => <tr key={n.id}><td><strong>{n.label}</strong></td><td>{n.kind}</td><td>{n.technology}</td><td>{n.description}</td></tr>)}</tbody></table></div>
                  <p className="muted">Create a blueprint from this scenario in the Architecture Finder to edit the diagram.</p>
                </details>
              )}
            </Card>
          )}
          {a.compare && Object.keys(a.compare).length > 0 && (
            <Card title="Facts for comparison"><dl className="kv">{Object.entries(a.compare).map(([key, value]) => <div key={key} style={{ display: "contents" }}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></Card>
          )}
        </div>

        <div className="stack">
          <Card title="Trust and provenance">
            <dl className="kv">
              <dt>Review status</dt><dd>{TRUST_LABELS[item.status].label}<div className="muted" style={{ fontWeight: 400 }}>{TRUST_LABELS[item.status].help}</div></dd>
              <dt>Origin</dt><dd>{ORIGIN_TEXT[item.origin] ?? item.origin}</dd>
              <dt>Source type</dt><dd>{sourceTypeLabel(item.sourceType)}</dd>
              <dt>Author</dt><dd>{detail.authorName ?? "Unknown"}</dd>
              <dt>Captured</dt><dd>{formatDate(item.createdAt)}</dd>
              <dt>Reviewer</dt><dd>{detail.reviewerName ? `${detail.reviewerName}, ${formatDateTime(item.reviewedAt)}` : "Not reviewed"}</dd>
              <dt>Last verified</dt><dd>{item.lastVerifiedAt ? formatDate(item.lastVerifiedAt) : "Never"}</dd>
              <dt>Confidence</dt><dd>{item.confidence === null ? "Not stated" : `${Math.round(item.confidence * 100)}% (author's estimate)`}</dd>
              <dt>Freshness policy</dt><dd>Stale after {detail.freshnessPolicyDays} days without verification</dd>
            </dl>
            {canEdit && <StatusActions id={item.id} status={item.status} hasSources={sources.length > 0} />}
          </Card>
          <Card title="Sources" aside={<Badge>{sources.length}</Badge>}>
            {sources.length === 0 && <p className="muted">No sources are cited. An item needs at least one source before it can be marked verified.</p>}
            {sources.map((s) => <SourceCitation key={s.source.id} source={s.source} note={s.note} />)}
            {canEdit && <SourceManager itemId={item.id} attached={sources.map((s) => ({ id: s.source.id, title: s.source.title }))} available={allSources.map((s) => ({ id: s.source.id, title: s.source.title })).filter((s) => !sources.some((x) => x.source.id === s.id))} locked={item.status === "verified"} />}
          </Card>
          <Card title="Related knowledge" aside={<Badge>{related.length}</Badge>}>
            {related.length === 0 && <p className="muted">No relationships yet. Link this item to the technologies, patterns and practices it connects to.</p>}
            {[...grouped.entries()].map(([key, list]) => {
              const [direction, type] = key.split(":");
              return (
                <div key={key} style={{ marginBottom: 10 }}>
                  <p className="muted" style={{ margin: 0, fontWeight: 700 }}>{direction === "out" ? type!.replace(/_/g, " ") : `${type!.replace(/_/g, " ")} (incoming)`}</p>
                  {list.map((r) => (
                    <div key={r.id} className="checkrow" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <span><Link href={`/knowledge/${r.other.slug}`}>{r.other.title}</Link> · {knowledgeTypeLabel(r.other.type)} · {r.other.status}{r.provenance !== "human" ? ` · ${r.provenance}` : ""}</span>
                      {canEdit && <RelationshipManager mode="remove" relationshipId={r.id} itemId={item.id} />}
                    </div>
                  ))}
                </div>
              );
            })}
            {canEdit && <RelationshipManager mode="add" itemId={item.id} />}
          </Card>
          <Card title="Version history">
            <VersionHistory current={item.version} versions={[{ version: item.version, createdAt: item.updatedAt, label: item.status }, ...versions.map((v) => ({ version: v.version, createdAt: v.createdAt, label: `was ${String(v.snapshot.status ?? "draft")}` }))]} />
          </Card>
        </div>
      </div>
    </>
  );
}
