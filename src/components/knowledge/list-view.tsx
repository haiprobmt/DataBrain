import Link from "next/link";
import { DemoTag, EmptyState, TrustBadge } from "@/components/ui";
import { KNOWLEDGE_TYPES, knowledgeTypeLabel, sourceTypeLabel } from "@/lib/catalog";
import { formatDate } from "@/lib/utils";
import type { Ctx } from "@/server/ctx";
import { freshnessPolicy, listItems, search, type KnowledgeListItem } from "@/server/services/knowledge";

interface Props {
  ctx: Ctx;
  basePath: string;
  /** Restrict the view to these knowledge types. */
  types?: string[];
  query: { q?: string; type?: string; status?: string; page?: string };
  emptyTitle: string;
  emptyText: string;
  newHref: string;
}

const PAGE_SIZE = 25;

/** Searchable, filterable table of knowledge items. Shared by the library and the typed views. */
export async function KnowledgeListView({ ctx, basePath, types, query, emptyTitle, emptyText, newHref }: Props) {
  const q = query.q?.trim() ?? "";
  const allowed = types ?? KNOWLEDGE_TYPES.map((t) => t.key);
  const selectedTypes = query.type && allowed.includes(query.type as never) ? [query.type] : types;
  const page = Math.max(1, Number(query.page) || 1);
  const policyDays = await freshnessPolicy(ctx);

  let rows: { item: KnowledgeListItem; why?: string[]; snippet?: string }[];
  let total: number;
  if (q) {
    const hits = await search(ctx, q, { types: selectedTypes, status: query.status || undefined, limit: 50, expand: true });
    rows = hits.map((h) => ({ item: h.item, why: h.why, snippet: h.snippet }));
    total = rows.length;
  } else {
    const result = await listItems(ctx, { types: selectedTypes, status: query.status || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, sort: "title" });
    rows = result.items.map((item) => ({ item }));
    total = result.total;
  }
  const params = (overrides: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: q || undefined, type: query.type, status: query.status, ...overrides })) if (value) sp.set(key, value);
    const text = sp.toString();
    return text ? `${basePath}?${text}` : basePath;
  };
  const filtered = !!(q || query.type || query.status);

  return (
    <section className="card padding">
      <form className="toolbar" action={basePath} role="search">
        <label className="sr-only" htmlFor="kq">Search</label>
        <input id="kq" name="q" type="search" className="input" defaultValue={q} placeholder="Search titles, summaries and article text…" />
        {allowed.length > 1 && (
          <>
            <label className="sr-only" htmlFor="ktype">Type</label>
            <select id="ktype" name="type" className="select" defaultValue={query.type ?? ""}>
              <option value="">All types</option>
              {KNOWLEDGE_TYPES.filter((t) => allowed.includes(t.key)).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </>
        )}
        <label className="sr-only" htmlFor="kstatus">Review status</label>
        <select id="kstatus" name="status" className="select" defaultValue={query.status ?? ""}>
          <option value="">Any status (not archived)</option>
          <option value="draft">Draft — review queue</option>
          <option value="reviewed">Reviewed</option>
          <option value="verified">Verified</option>
          <option value="archived">Archived</option>
        </select>
        <button className="btn">Apply</button>
        {filtered && <Link href={basePath} className="btn">Clear</Link>}
      </form>

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState title="No matches" action={<Link href={basePath} className="btn">Clear filters</Link>}>Nothing matches these filters. Try fewer words or a different type.</EmptyState>
        ) : (
          <EmptyState title={emptyTitle} action={<Link href={newHref} className="btn primary">Add the first one</Link>}>{emptyText}</EmptyState>
        )
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>{q ? `${total} result${total === 1 ? "" : "s"}, best match first. Connected items are included.` : `${total} item${total === 1 ? "" : "s"}`}</p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Title</th><th>Type</th><th>Trust</th><th>Source type</th><th>Last verified</th></tr></thead>
              <tbody>
                {rows.map(({ item, why, snippet }) => (
                  <tr key={item.id}>
                    <td style={{ maxWidth: 560 }}>
                      <Link href={`/knowledge/${item.slug}`}>{item.title}</Link> {item.isDemo && <DemoTag />}
                      <div className="muted">{snippet ? snippet.split(/[«»]/).map((part, i) => (i % 2 ? <mark key={i} style={{ background: "#fff1dd" }}>{part}</mark> : part)) : item.summary.length > 170 ? `${item.summary.slice(0, 170)}…` : item.summary}</div>
                      {why && why.length > 0 && <div className="muted" style={{ color: "#245fa8" }}>Why: {why.join(" · ")}</div>}
                    </td>
                    <td>{knowledgeTypeLabel(item.type)}</td>
                    <td><TrustBadge status={item.status} lastVerifiedAt={item.lastVerifiedAt} policyDays={policyDays} /></td>
                    <td>{sourceTypeLabel(item.sourceType)}</td>
                    <td>{item.lastVerifiedAt ? formatDate(item.lastVerifiedAt) : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!q && total > PAGE_SIZE && (
            <nav className="actions" aria-label="Pages" style={{ marginTop: 14, justifyContent: "space-between" }}>
              {page > 1 ? <Link className="btn mini" href={params({ page: String(page - 1) })}>← Previous</Link> : <span />}
              <span className="muted">Page {page} of {Math.ceil(total / PAGE_SIZE)}</span>
              {page * PAGE_SIZE < total ? <Link className="btn mini" href={params({ page: String(page + 1) })}>Next →</Link> : <span />}
            </nav>
          )}
        </>
      )}
    </section>
  );
}
