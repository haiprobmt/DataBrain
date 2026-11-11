import Link from "next/link";
import { Card, DemoTag, EmptyState, PageHeader, TrustBadge } from "@/components/ui";
import { requireCtx } from "@/server/auth";
import { getItem, getRelated, listItems } from "@/server/services/knowledge";

export const metadata = { title: "Technology Compare" };

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const ctx = await requireCtx();
  const raw = (await searchParams).id;
  const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).slice(0, 4);
  const { items: technologies } = await listItems(ctx, { types: ["technology"], limit: 200, sort: "title" });
  const selected = (await Promise.all(ids.map((id) => getItem(ctx, id).catch(() => null)))).filter((i): i is NonNullable<typeof i> => !!i && i.type === "technology");
  const related = await Promise.all(selected.map((item) => getRelated(ctx, item.id)));
  const rows = [...new Set(selected.flatMap((item) => Object.keys(item.attributes.compare ?? {})))];
  const section = (item: (typeof selected)[number], key: string) => item.sections.find((s) => s.key === key)?.body;

  return (
    <>
      <PageHeader title="Technology Compare" description="Put two to four technologies side by side, using only the facts recorded in the knowledge base. Empty cells mean nothing is recorded — not that the answer is no." />
      <div className="gridtwo" style={{ ["--cols" as string]: "minmax(240px, 0.4fr) minmax(0, 1.6fr)" }}>
        <Card title="Technologies">
          {technologies.length === 0 ? (
            <EmptyState title="No technologies recorded" action={<Link className="btn primary" href="/knowledge/new?type=technology">Add a technology</Link>}>Add technology items to the Knowledge Library to compare them.</EmptyState>
          ) : (
            <form action="/compare">
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="sr-only">Choose up to four technologies</legend>
                {technologies.map((t) => (
                  <div className="checkrow" key={t.id}>
                    <input type="checkbox" name="id" value={t.id} id={`c-${t.id}`} defaultChecked={ids.includes(t.id)} />
                    <label htmlFor={`c-${t.id}`}><strong>{t.title}</strong><span>{t.attributes.category ?? "Technology"}</span></label>
                  </div>
                ))}
              </fieldset>
              <div className="actions" style={{ marginTop: 12 }}>
                <button className="btn primary">Compare selected</button>
                {ids.length > 0 && <Link href="/compare" className="btn">Clear</Link>}
              </div>
              <p className="muted" style={{ marginTop: 8 }}>Up to four. Extra selections are ignored.</p>
            </form>
          )}
        </Card>
        <Card title="Comparison">
          {selected.length < 2 ? (
            <EmptyState title="Select at least two technologies">Tick two to four technologies and choose “Compare selected”.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th style={{ width: 150 }}></th>{selected.map((item) => <th key={item.id}><Link href={`/knowledge/${item.slug}`}>{item.title}</Link> {item.isDemo && <DemoTag />}</th>)}</tr></thead>
                <tbody>
                  <tr><td><strong>Trust</strong></td>{selected.map((item) => <td key={item.id}><TrustBadge status={item.status} lastVerifiedAt={item.lastVerifiedAt} /></td>)}</tr>
                  <tr><td><strong>Summary</strong></td>{selected.map((item) => <td key={item.id}>{item.summary}</td>)}</tr>
                  {rows.map((row) => <tr key={row}><td><strong>{row}</strong></td>{selected.map((item) => <td key={item.id}>{item.attributes.compare?.[row] ?? <span className="muted">Not recorded</span>}</td>)}</tr>)}
                  <tr><td><strong>Core concepts</strong></td>{selected.map((item) => <td key={item.id}>{section(item, "concepts") ?? <span className="muted">Not recorded</span>}</td>)}</tr>
                  <tr><td><strong>Limitations</strong></td>{selected.map((item) => <td key={item.id}>{section(item, "limitations") ?? <span className="muted">Not recorded</span>}</td>)}</tr>
                  <tr><td><strong>Used by scenarios</strong></td>{selected.map((item, i) => { const used = related[i]!.filter((r) => r.other.type === "scenario"); return <td key={item.id}>{used.length ? used.map((r) => <div key={r.id}><Link href={`/knowledge/${r.other.slug}`}>{r.other.title}</Link></div>) : <span className="muted">None</span>}</td>; })}</tr>
                  <tr><td><strong>Recorded alternatives</strong></td>{selected.map((item, i) => { const alt = related[i]!.filter((r) => r.type === "alternative_to"); return <td key={item.id}>{alt.length ? alt.map((r) => <div key={r.id}><Link href={`/knowledge/${r.other.slug}`}>{r.other.title}</Link></div>) : <span className="muted">None</span>}</td>; })}</tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
