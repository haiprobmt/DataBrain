import { and, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { knowledgeTypeLabel } from "@/lib/catalog";
import type { KnowledgeInput } from "@/lib/schemas";
import type { KnowledgeAttributes, KnowledgeSection } from "@/lib/types";
import { slugify, tokenize, uniq } from "@/lib/utils";
import { audit } from "../audit";
import { assertCanEdit, type Ctx } from "../ctx";
import { sha256 } from "../crypto";
import { getDb, schema, type Tx } from "../db";
import { env } from "../env";
import { AppError, conflict, notFound, precondition } from "../errors";
import { getEmbeddings, getExtractors, getLLM, getReranker, getStorage } from "../providers";
import { cosine } from "../providers/local";

const k = schema.knowledgeItems;
export type KnowledgeItem = typeof k.$inferSelect;

/** Columns for list views: everything except the heavy search vector. */
const listColumns = {
  id: k.id,
  slug: k.slug,
  type: k.type,
  title: k.title,
  summary: k.summary,
  tags: k.tags,
  status: k.status,
  origin: k.origin,
  sourceType: k.sourceType,
  confidence: k.confidence,
  version: k.version,
  lastVerifiedAt: k.lastVerifiedAt,
  isDemo: k.isDemo,
  attributes: k.attributes,
  updatedAt: k.updatedAt,
};
export type KnowledgeListItem = Pick<KnowledgeItem, keyof typeof listColumns>;

function buildSearchText(input: { sections: KnowledgeSection[]; tags: string[]; attributes: KnowledgeAttributes }): string {
  const a = input.attributes;
  const attributeText = [a.platforms, a.clouds, a.workloads, a.latency, a.sourceSystems, a.security, a.skills, a.costDrivers, a.tradeoffs, a.limitations, a.steps]
    .flatMap((list) => list ?? [])
    .join(" ");
  const diagramText = (a.diagram?.nodes ?? []).map((n) => `${n.label} ${n.technology ?? ""}`).join(" ");
  return [input.sections.map((s) => `${s.title}\n${s.body}`).join("\n"), input.tags.join(" "), attributeText, diagramText, a.vendor, a.category].filter(Boolean).join("\n");
}

async function uniqueSlug(tx: Tx, workspaceId: string, title: string, excludeId?: string): Promise<string> {
  const base = slugify(title) || "item";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const [hit] = await tx
      .select({ id: k.id })
      .from(k)
      .where(and(eq(k.workspaceId, workspaceId), eq(k.slug, slug), excludeId ? ne(k.id, excludeId) : undefined))
      .limit(1);
    if (!hit) return slug;
  }
  return `${base}-${Date.now()}`;
}

async function indexEmbedding(tx: Tx, workspaceId: string, item: { id: string; title: string; summary: string; searchText: string }): Promise<void> {
  const provider = getEmbeddings();
  const [vector] = await provider.embed([`${item.title}\n${item.summary}\n${item.searchText}`.slice(0, 8000)]);
  if (!vector) return;
  await tx
    .insert(schema.embeddings)
    .values({ workspaceId, itemId: item.id, provider: provider.name, model: provider.model, vector })
    .onConflictDoUpdate({ target: [schema.embeddings.itemId, schema.embeddings.provider, schema.embeddings.model], set: { vector, createdAt: new Date() } });
}

// ── Read ────────────────────────────────────────────────────────────────────
export interface ListFilters {
  q?: string;
  types?: string[];
  status?: string;
  tag?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
  sort?: "updated" | "title";
}

export async function listItems(ctx: Ctx, filters: ListFilters = {}) {
  const db = getDb();
  const where: (SQL | undefined)[] = [eq(k.workspaceId, ctx.workspaceId)];
  if (filters.types?.length) where.push(inArray(k.type, filters.types));
  if (filters.status) where.push(eq(k.status, filters.status as KnowledgeItem["status"]));
  else if (!filters.includeArchived) where.push(ne(k.status, "archived"));
  if (filters.tag) where.push(sql`${filters.tag} = any(${k.tags})`);
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.push(or(sql`${k.search} @@ websearch_to_tsquery('english', ${q})`, sql`${k.title} ilike ${"%" + q.replace(/[%_]/g, "") + "%"}`));
  }
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const condition = and(...where);
  const [items, [count]] = await Promise.all([
    db.select(listColumns).from(k).where(condition).orderBy(filters.sort === "title" ? k.title : desc(k.updatedAt), k.title).limit(limit).offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(k).where(condition),
  ]);
  return { items, total: count?.n ?? 0, limit, offset };
}

export async function getItem(ctx: Ctx, idOrSlug: string): Promise<KnowledgeItem> {
  const db = getDb();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const [item] = await db
    .select()
    .from(k)
    .where(and(eq(k.workspaceId, ctx.workspaceId), isUuid ? eq(k.id, idOrSlug) : eq(k.slug, idOrSlug)))
    .limit(1);
  if (!item) throw notFound("Knowledge item");
  return item;
}

export async function getItemsByIds(ctx: Ctx, ids: string[]): Promise<KnowledgeListItem[]> {
  if (ids.length === 0) return [];
  return getDb().select(listColumns).from(k).where(and(eq(k.workspaceId, ctx.workspaceId), inArray(k.id, ids)));
}

export async function getItemSources(ctx: Ctx, itemIds: string[]) {
  if (itemIds.length === 0) return [];
  return getDb()
    .select({ itemId: schema.knowledgeItemSources.itemId, note: schema.knowledgeItemSources.note, source: schema.sources })
    .from(schema.knowledgeItemSources)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.knowledgeItemSources.sourceId))
    .where(and(eq(schema.sources.workspaceId, ctx.workspaceId), inArray(schema.knowledgeItemSources.itemId, itemIds)));
}

export interface RelatedEdge {
  id: string;
  type: string;
  direction: "out" | "in";
  note: string | null;
  provenance: string;
  other: { id: string; slug: string; title: string; type: string; status: string };
}

export async function getRelated(ctx: Ctx, itemId: string): Promise<RelatedEdge[]> {
  const db = getDb();
  const r = schema.relationships;
  const rows = await db
    .select({ rel: r, other: { id: k.id, slug: k.slug, title: k.title, type: k.type, status: k.status } })
    .from(r)
    .innerJoin(k, or(and(eq(r.fromId, itemId), eq(k.id, r.toId)), and(eq(r.toId, itemId), eq(k.id, r.fromId))))
    .where(and(eq(r.workspaceId, ctx.workspaceId), or(eq(r.fromId, itemId), eq(r.toId, itemId))));
  return rows
    .map((row) => ({
      id: row.rel.id,
      type: row.rel.type,
      direction: (row.rel.fromId === itemId ? "out" : "in") as "out" | "in",
      note: row.rel.note,
      provenance: row.rel.provenance,
      other: row.other,
    }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.other.title.localeCompare(b.other.title));
}

export async function getItemDetail(ctx: Ctx, idOrSlug: string) {
  const item = await getItem(ctx, idOrSlug);
  const db = getDb();
  const [sources, related, versions, people] = await Promise.all([
    getItemSources(ctx, [item.id]),
    getRelated(ctx, item.id),
    db
      .select({ id: schema.knowledgeItemVersions.id, version: schema.knowledgeItemVersions.version, createdAt: schema.knowledgeItemVersions.createdAt, snapshot: schema.knowledgeItemVersions.snapshot })
      .from(schema.knowledgeItemVersions)
      .where(eq(schema.knowledgeItemVersions.itemId, item.id))
      .orderBy(desc(schema.knowledgeItemVersions.version)),
    db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(inArray(schema.users.id, [item.authorId, item.reviewerId].filter((v): v is string => !!v).concat("00000000-0000-0000-0000-000000000000"))),
  ]);
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  return { item, sources, related, versions, authorName: name(item.authorId), reviewerName: name(item.reviewerId), freshnessPolicyDays: await freshnessPolicy(ctx) };
}

export async function freshnessPolicy(ctx: Ctx): Promise<number> {
  const [ws] = await getDb().select({ settings: schema.workspaces.settings }).from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId)).limit(1);
  return ws?.settings.freshnessPolicyDays ?? env.freshnessPolicyDays;
}

// ── Write ───────────────────────────────────────────────────────────────────
export async function createItem(ctx: Ctx, input: KnowledgeInput, options: { origin?: KnowledgeItem["origin"]; isDemo?: boolean; slug?: string } = {}) {
  assertCanEdit(ctx);
  const db = getDb();
  return db.transaction(async (tx) => {
    const searchText = buildSearchText(input);
    const [item] = await tx
      .insert(k)
      .values({
        workspaceId: ctx.workspaceId,
        slug: options.slug ?? (await uniqueSlug(tx, ctx.workspaceId, input.title)),
        type: input.type,
        title: input.title,
        summary: input.summary,
        sections: input.sections,
        attributes: input.attributes as KnowledgeAttributes,
        tags: uniq(input.tags.map((t) => t.toLowerCase())),
        sourceType: input.sourceType,
        confidence: input.confidence,
        origin: options.origin ?? "human",
        isDemo: options.isDemo ?? false,
        authorId: ctx.userId,
        searchText,
      })
      .returning();
    if (!item) throw new AppError("internal_error", "Knowledge item could not be created.");
    await indexEmbedding(tx, ctx.workspaceId, item);
    await audit(ctx, { action: "knowledge.create", entityType: "knowledge_item", entityId: item.id, summary: `Created ${knowledgeTypeLabel(item.type)} “${item.title}”` }, tx);
    return item;
  });
}

export async function updateItem(ctx: Ctx, id: string, input: KnowledgeInput & { expectedVersion: number; confirmVerifiedEdit: boolean }) {
  assertCanEdit(ctx);
  const current = await getItem(ctx, id);
  if (current.version !== input.expectedVersion) {
    throw conflict("This item was changed by someone else. Reload it and apply your edit again.", { currentVersion: current.version });
  }
  if (current.status === "verified" && !input.confirmVerifiedEdit) {
    throw new AppError("precondition_failed", "This item is verified. Editing it returns it to draft until it is verified again — confirm to continue.", undefined, { requiresConfirmation: "confirmVerifiedEdit" });
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.insert(schema.knowledgeItemVersions).values({
      itemId: current.id,
      version: current.version,
      changedBy: ctx.userId,
      snapshot: { title: current.title, type: current.type, summary: current.summary, sections: current.sections, attributes: current.attributes, tags: current.tags, status: current.status, sourceType: current.sourceType, confidence: current.confidence, lastVerifiedAt: current.lastVerifiedAt },
    });
    const searchText = buildSearchText(input);
    // Content that was verified or reviewed has not been checked in its new form.
    const status = current.status === "archived" ? "archived" : "draft";
    const [updated] = await tx
      .update(k)
      .set({
        title: input.title,
        type: input.type,
        summary: input.summary,
        sections: input.sections,
        attributes: input.attributes as KnowledgeAttributes,
        tags: uniq(input.tags.map((t) => t.toLowerCase())),
        sourceType: input.sourceType,
        confidence: input.confidence,
        searchText,
        status,
        version: current.version + 1,
      })
      .where(and(eq(k.id, current.id), eq(k.version, current.version)))
      .returning();
    if (!updated) throw conflict("This item was changed by someone else. Reload it and apply your edit again.");
    await indexEmbedding(tx, ctx.workspaceId, updated);
    await audit(ctx, { action: "knowledge.update", entityType: "knowledge_item", entityId: updated.id, summary: `Edited “${updated.title}” (v${updated.version})`, metadata: { previousStatus: current.status } }, tx);
    return updated;
  });
}

export async function setItemStatus(ctx: Ctx, id: string, status: KnowledgeItem["status"]) {
  assertCanEdit(ctx);
  const item = await getItem(ctx, id);
  const db = getDb();
  if (status === "verified") {
    const sources = await getItemSources(ctx, [item.id]);
    if (sources.length === 0) throw precondition("Add at least one source before marking this item verified: verification means it was checked against an identified source.");
  }
  const now = new Date();
  const patch: Partial<KnowledgeItem> = { status };
  if (status === "reviewed" || status === "verified") {
    patch.reviewerId = ctx.userId;
    patch.reviewedAt = now;
  }
  if (status === "verified") patch.lastVerifiedAt = now;
  const [updated] = await db.update(k).set(patch).where(eq(k.id, item.id)).returning();
  await audit(ctx, { action: `knowledge.status.${status}`, entityType: "knowledge_item", entityId: item.id, summary: `Marked “${item.title}” as ${status}`, metadata: { from: item.status } });
  return updated!;
}

// ── Sources ─────────────────────────────────────────────────────────────────
export async function listSources(ctx: Ctx) {
  const db = getDb();
  const s = schema.sources;
  return db
    .select({ source: s, citations: sql<number>`(select count(*)::int from ${schema.knowledgeItemSources} where ${schema.knowledgeItemSources.sourceId} = ${s.id})` })
    .from(s)
    .where(eq(s.workspaceId, ctx.workspaceId))
    .orderBy(s.title);
}

export async function createSource(ctx: Ctx, input: { title: string; url: string; publisher: string; sourceType: (typeof schema.sources.$inferSelect)["sourceType"]; itemId?: string; note?: string }) {
  assertCanEdit(ctx);
  const item = input.itemId ? await getItem(ctx, input.itemId) : null;
  return getDb().transaction(async (tx) => {
    const [source] = await tx
      .insert(schema.sources)
      .values({ workspaceId: ctx.workspaceId, title: input.title, url: input.url || null, publisher: input.publisher || null, sourceType: input.sourceType })
      .returning();
    if (item) await tx.insert(schema.knowledgeItemSources).values({ itemId: item.id, sourceId: source!.id, note: input.note ?? null });
    await audit(ctx, { action: "source.create", entityType: "source", entityId: source!.id, summary: `Added source “${input.title}”${item ? ` to “${item.title}”` : ""}` }, tx);
    return source!;
  });
}

async function getSource(ctx: Ctx, id: string) {
  const [source] = await getDb().select().from(schema.sources).where(and(eq(schema.sources.id, id), eq(schema.sources.workspaceId, ctx.workspaceId))).limit(1);
  if (!source) throw notFound("Source");
  return source;
}

export async function attachSource(ctx: Ctx, itemId: string, sourceId: string, note?: string) {
  assertCanEdit(ctx);
  const [item, source] = await Promise.all([getItem(ctx, itemId), getSource(ctx, sourceId)]);
  await getDb().insert(schema.knowledgeItemSources).values({ itemId: item.id, sourceId: source.id, note: note ?? null }).onConflictDoNothing();
  await audit(ctx, { action: "source.attach", entityType: "knowledge_item", entityId: item.id, summary: `Cited “${source.title}” on “${item.title}”` });
}

export async function detachSource(ctx: Ctx, itemId: string, sourceId: string) {
  assertCanEdit(ctx);
  const [item, source] = await Promise.all([getItem(ctx, itemId), getSource(ctx, sourceId)]);
  if (item.status === "verified") throw precondition("Verified items keep their sources. Return the item to draft before removing a citation.");
  await getDb().delete(schema.knowledgeItemSources).where(and(eq(schema.knowledgeItemSources.itemId, item.id), eq(schema.knowledgeItemSources.sourceId, source.id)));
  await audit(ctx, { action: "source.detach", entityType: "knowledge_item", entityId: item.id, summary: `Removed citation “${source.title}” from “${item.title}”` });
}

export async function markSourceVerified(ctx: Ctx, sourceId: string) {
  assertCanEdit(ctx);
  const source = await getSource(ctx, sourceId);
  await getDb().update(schema.sources).set({ lastVerifiedAt: new Date() }).where(eq(schema.sources.id, source.id));
  await audit(ctx, { action: "source.verify", entityType: "source", entityId: source.id, summary: `Recorded a verification check of source “${source.title}”` });
}

// ── Relationships ───────────────────────────────────────────────────────────
export async function addRelationship(ctx: Ctx, input: { fromId: string; toId: string; type: string; note?: string; confidence?: number }, provenance = "human") {
  assertCanEdit(ctx);
  if (input.fromId === input.toId) throw new AppError("validation_error", "An item cannot be related to itself.", { toId: ["Choose a different item."] });
  const [from, to] = await Promise.all([getItem(ctx, input.fromId), getItem(ctx, input.toId)]);
  const [rel] = await getDb()
    .insert(schema.relationships)
    .values({ workspaceId: ctx.workspaceId, fromId: from.id, toId: to.id, type: input.type, note: input.note ?? null, confidence: input.confidence ?? null, provenance })
    .onConflictDoNothing()
    .returning();
  if (!rel) throw conflict("That relationship already exists.");
  await audit(ctx, { action: "relationship.create", entityType: "relationship", entityId: rel.id, summary: `Linked “${from.title}” ${input.type} “${to.title}”` });
  return rel;
}

export async function removeRelationship(ctx: Ctx, id: string) {
  assertCanEdit(ctx);
  const [rel] = await getDb().delete(schema.relationships).where(and(eq(schema.relationships.id, id), eq(schema.relationships.workspaceId, ctx.workspaceId))).returning();
  if (!rel) throw notFound("Relationship");
  await audit(ctx, { action: "relationship.delete", entityType: "relationship", entityId: id, summary: `Removed a ${rel.type} relationship` });
}

// ── Search ──────────────────────────────────────────────────────────────────
export interface SearchHit {
  item: KnowledgeListItem;
  score: number;
  lexical: number;
  semantic: number;
  snippet: string;
  /** Plain-language reasons the item matched. */
  why: string[];
  via?: { title: string; type: string };
}

export async function search(ctx: Ctx, query: string, options: { types?: string[]; status?: string; limit?: number; expand?: boolean } = {}): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const db = getDb();
  const scope = and(eq(k.workspaceId, ctx.workspaceId), options.status ? eq(k.status, options.status as KnowledgeItem["status"]) : ne(k.status, "archived"), options.types?.length ? inArray(k.type, options.types) : undefined);

  const lexicalRows = await db
    .select({
      ...listColumns,
      rank: sql<number>`ts_rank(${k.search}, websearch_to_tsquery('english', ${q}))`,
      snippet: sql<string>`ts_headline('english', coalesce(${k.summary},'') || ' ' || coalesce(${k.searchText},''), websearch_to_tsquery('english', ${q}), 'MaxWords=28, MinWords=12, StartSel=«, StopSel=»')`,
    })
    .from(k)
    .where(and(scope, sql`${k.search} @@ websearch_to_tsquery('english', ${q})`))
    .orderBy(sql`2 desc`)
    .limit(40);

  const provider = getEmbeddings();
  const [queryVector] = await provider.embed([q]);
  const vectorRows = await db
    .select({ ...listColumns, vector: schema.embeddings.vector })
    .from(schema.embeddings)
    .innerJoin(k, eq(k.id, schema.embeddings.itemId))
    .where(and(scope, eq(schema.embeddings.provider, provider.name), eq(schema.embeddings.model, provider.model)));

  const maxRank = Math.max(...lexicalRows.map((r) => r.rank), 0.0001);
  const hits = new Map<string, SearchHit>();
  const queryTokens = uniq(tokenize(q)).filter((t) => t.length > 2);
  const whyLexical = (item: KnowledgeListItem) => {
    const inTitle = queryTokens.filter((t) => item.title.toLowerCase().includes(t));
    const inSummary = queryTokens.filter((t) => !inTitle.includes(t) && item.summary.toLowerCase().includes(t));
    const why: string[] = [];
    if (inTitle.length) why.push(`Title contains: ${inTitle.join(", ")}`);
    if (inSummary.length) why.push(`Summary contains: ${inSummary.join(", ")}`);
    if (!why.length) why.push("Matching terms in the article body or attributes");
    return why;
  };

  for (const row of lexicalRows) {
    const { rank, snippet, ...item } = row;
    const lexical = rank / maxRank;
    hits.set(item.id, { item, score: 0, lexical, semantic: 0, snippet, why: whyLexical(item) });
  }
  if (queryVector) {
    for (const row of vectorRows) {
      const { vector, ...item } = row;
      const semantic = Math.max(0, cosine(queryVector, vector));
      const existing = hits.get(item.id);
      if (existing) {
        existing.semantic = semantic;
      } else if (semantic >= 0.18) {
        hits.set(item.id, { item, score: 0, lexical: 0, semantic, snippet: item.summary.slice(0, 220), why: [] });
      }
    }
  }
  for (const hit of hits.values()) {
    hit.score = 0.65 * hit.lexical + 0.35 * hit.semantic;
    if (hit.semantic >= 0.18) hit.why.push(`Similar wording to the query (${provider.name} similarity ${hit.semantic.toFixed(2)})`);
  }

  let ranked = await getReranker().rerank(q, [...hits.values()]);
  ranked = ranked.slice(0, options.limit ?? 20);

  if (options.expand && ranked.length > 0) {
    const top = ranked.slice(0, 5);
    const r = schema.relationships;
    const topIds = top.map((h) => h.item.id);
    const edges = await db.select().from(r).where(and(eq(r.workspaceId, ctx.workspaceId), or(inArray(r.fromId, topIds), inArray(r.toId, topIds))));
    const known = new Set(ranked.map((h) => h.item.id));
    const neighbourIds = uniq(edges.flatMap((edge) => [edge.fromId, edge.toId])).filter((id) => !known.has(id));
    const neighbours = await getItemsByIds(ctx, neighbourIds.slice(0, 30));
    for (const neighbour of neighbours) {
      if (neighbour.status === "archived") continue;
      const edge = edges.find((e2) => e2.fromId === neighbour.id || e2.toId === neighbour.id);
      const parent = top.find((h) => h.item.id === edge?.fromId || h.item.id === edge?.toId);
      if (!edge || !parent) continue;
      ranked.push({
        item: neighbour,
        score: parent.score * 0.5,
        lexical: 0,
        semantic: 0,
        snippet: neighbour.summary.slice(0, 220),
        why: [`Connected to “${parent.item.title}” (${edge.type.replace(/_/g, " ")})`],
        via: { title: parent.item.title, type: edge.type },
      });
    }
  }
  return ranked;
}

// ── Graph ───────────────────────────────────────────────────────────────────
const GRAPH_NODE_LIMIT = 150;

export async function getGraph(ctx: Ctx, options: { focusId?: string; depth?: number; types?: string[]; status?: string; q?: string } = {}) {
  const db = getDb();
  const r = schema.relationships;
  const allEdges = await db.select({ id: r.id, fromId: r.fromId, toId: r.toId, type: r.type, note: r.note }).from(r).where(eq(r.workspaceId, ctx.workspaceId));
  const { items } = await listItems(ctx, { types: options.types, status: options.status, q: options.q, limit: 200, sort: "title" });
  let nodes = items;

  if (options.focusId) {
    const depth = Math.min(Math.max(options.depth ?? 1, 1), 3);
    const reach = new Set([options.focusId]);
    for (let d = 0; d < depth; d++) {
      for (const edge of allEdges) {
        if (reach.has(edge.fromId) || reach.has(edge.toId)) {
          reach.add(edge.fromId);
          reach.add(edge.toId);
        }
      }
    }
    // Neighbours of the focus item are kept even when a filter would hide them.
    nodes = await getItemsByIds(ctx, [...reach]);
    nodes = nodes.filter((n) => n.status !== "archived" || n.id === options.focusId);
  }
  const truncated = nodes.length > GRAPH_NODE_LIMIT;
  nodes = nodes.slice(0, GRAPH_NODE_LIMIT);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = allEdges.filter((edge) => ids.has(edge.fromId) && ids.has(edge.toId));
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.fromId, (degree.get(edge.fromId) ?? 0) + 1);
    degree.set(edge.toId, (degree.get(edge.toId) ?? 0) + 1);
  }
  return {
    nodes: nodes.map((n) => ({ id: n.id, slug: n.slug, title: n.title, type: n.type, status: n.status, summary: n.summary, isDemo: n.isDemo, origin: n.origin, degree: degree.get(n.id) ?? 0 })),
    edges,
    truncated,
  };
}

// ── Ingestion ───────────────────────────────────────────────────────────────
export function chunkText(text: string, size = 900): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > size) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
    while (current.length > size * 2) {
      chunks.push(current.slice(0, size));
      current = current.slice(size);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Split a markdown document into article sections by its `##` headings. */
export function markdownToSections(text: string): { summary: string; sections: KnowledgeSection[] } {
  const body = text.replace(/^#\s+.+$/m, "").trim();
  const parts = body.split(/^##\s+/m);
  const intro = (parts.shift() ?? "").trim();
  const sections = parts.map((part) => {
    const [heading = "Section", ...rest] = part.split("\n");
    return { key: slugify(heading) || "section", title: heading.trim().slice(0, 120), body: rest.join("\n").trim().slice(0, 20000) };
  });
  const firstParagraph = intro.split(/\n{2,}/)[0] ?? "";
  const summary = (firstParagraph || sections[0]?.body.split(/\n{2,}/)[0] || "Imported document.").replace(/\s+/g, " ").slice(0, 1100);
  if (sections.length === 0 && intro) sections.push({ key: "content", title: "Content", body: intro.slice(0, 20000) });
  return { summary, sections };
}

export async function importDocument(ctx: Ctx, input: { fileName: string; content: string; type: string; sourceType: KnowledgeItem["sourceType"]; url: string }) {
  assertCanEdit(ctx);
  const extractor = getExtractors().find((x) => x.supports(input.fileName));
  if (!extractor) {
    throw new AppError("validation_error", "Only Markdown (.md) and plain-text (.txt) files can be imported.", { fileName: ["Unsupported file type. Use .md or .txt."] });
  }
  const bytes = new TextEncoder().encode(input.content);
  const { text, title } = await extractor.extract(input.fileName, bytes);
  const checksum = sha256(bytes);
  const db = getDb();

  // Duplicate detection: identical file, or an existing item with a near-identical title.
  const [sameFile] = await db.select().from(schema.sources).where(and(eq(schema.sources.workspaceId, ctx.workspaceId), eq(schema.sources.checksum, checksum))).limit(1);
  if (sameFile) throw conflict(`This exact file was already imported as source “${sameFile.title}”.`, { sourceId: sameFile.id });
  const titleTokens = new Set(tokenize(title));
  const { items: existing } = await listItems(ctx, { limit: 200, includeArchived: true });
  const duplicates = existing
    .map((item) => {
      const other = new Set(tokenize(item.title));
      const overlap = [...titleTokens].filter((t) => other.has(t)).length;
      return { item, similarity: overlap / Math.max(new Set([...titleTokens, ...other]).size, 1) };
    })
    .filter((d) => d.similarity >= 0.6)
    .map((d) => ({ id: d.item.id, slug: d.item.slug, title: d.item.title, similarity: Number(d.similarity.toFixed(2)) }));

  const stored = await getStorage().put(`sources/${ctx.workspaceId}/${checksum.slice(0, 16)}-${input.fileName}`, bytes);
  const { summary, sections } = markdownToSections(text);

  const result = await db.transaction(async (tx) => {
    const [source] = await tx
      .insert(schema.sources)
      .values({ workspaceId: ctx.workspaceId, title: `${title} (${input.fileName})`, url: input.url || null, sourceType: input.sourceType, fileKey: stored.key, checksum })
      .returning();
    const [item] = await tx
      .insert(k)
      .values({
        workspaceId: ctx.workspaceId,
        slug: await uniqueSlug(tx, ctx.workspaceId, title),
        type: input.type,
        title: title.slice(0, 160),
        summary,
        sections,
        tags: [],
        sourceType: input.sourceType,
        origin: "imported",
        status: "draft",
        authorId: ctx.userId,
        searchText: buildSearchText({ sections, tags: [], attributes: {} }),
      })
      .returning();
    await tx.insert(schema.knowledgeItemSources).values({ itemId: item!.id, sourceId: source!.id, note: "Imported from this file" });
    const chunks = chunkText(text);
    if (chunks.length) {
      await tx.insert(schema.sourceChunks).values(chunks.map((content, ordinal) => ({ workspaceId: ctx.workspaceId, sourceId: source!.id, itemId: item!.id, ordinal, content })));
    }
    await indexEmbedding(tx, ctx.workspaceId, item!);
    await audit(ctx, { action: "knowledge.import", entityType: "knowledge_item", entityId: item!.id, summary: `Imported “${title}” from ${input.fileName} into the review queue`, metadata: { checksum, chunks: chunks.length } }, tx);
    return { item: item!, source: source!, chunks: chunks.length };
  });
  return { ...result, duplicates };
}

// ── Grounded answers (AI Workspace) ─────────────────────────────────────────
/**
 * Extractive answer: the best-matching passages from the knowledge base, quoted with their citations.
 * No text is generated — with no generative model configured, the workspace only quotes what is stored.
 */
export async function ask(ctx: Ctx, question: string) {
  const hits = await search(ctx, question, { limit: 6, expand: false });
  const queryTokens = uniq(tokenize(question)).filter((t) => t.length > 2);
  const itemIds = hits.map((h) => h.item.id);
  const [full, sources] = await Promise.all([
    itemIds.length ? getDb().select().from(k).where(and(eq(k.workspaceId, ctx.workspaceId), inArray(k.id, itemIds))) : [],
    getItemSources(ctx, itemIds),
  ]);
  const passages = hits.map((hit) => {
    const item = full.find((f) => f.id === hit.item.id);
    const candidates = [hit.item.summary, ...(item?.sections ?? []).flatMap((s) => s.body.split(/\n{2,}/).map((p) => `${s.title}: ${p}`))];
    const scored = candidates
      .map((text) => ({ text, score: queryTokens.filter((t) => text.toLowerCase().includes(t)).length }))
      .sort((a, b) => b.score - a.score);
    return {
      item: { id: hit.item.id, slug: hit.item.slug, title: hit.item.title, type: hit.item.type, status: hit.item.status, isDemo: hit.item.isDemo, origin: hit.item.origin },
      passage: (scored[0]?.text ?? hit.item.summary).slice(0, 700),
      why: hit.why,
      sources: sources.filter((s) => s.itemId === hit.item.id).map((s) => ({ id: s.source.id, title: s.source.title, url: s.source.url, sourceType: s.source.sourceType })),
    };
  });
  // With a generative provider, Claude writes an answer from these passages only. If that call fails,
  // the passages are still returned and the failure is reported — never replaced by something made up.
  const llm = getLLM();
  let answer: { text: string; model: string } | null = null;
  let answerError: string | null = null;
  if (llm.answer && passages.length > 0) {
    try {
      answer = await llm.answer(question, passages.map((p, i) => ({ n: i + 1, title: p.item.title, status: p.item.status, text: p.passage })));
    } catch (error) {
      answerError = error instanceof Error ? error.message : "The answer could not be generated.";
    }
  }
  await audit(ctx, { action: "workspace.ask", entityType: "knowledge", summary: "Asked the knowledge base a question", metadata: { results: passages.length, provider: llm.name, model: answer?.model ?? null, generated: !!answer } });
  return { mode: answer ? ("generated" as const) : ("extractive" as const), provider: llm.name, answer, answerError, passages };
}

export async function knowledgeStats(ctx: Ctx) {
  const rows = await getDb()
    .select({ type: k.type, status: k.status, n: sql<number>`count(*)::int` })
    .from(k)
    .where(eq(k.workspaceId, ctx.workspaceId))
    .groupBy(k.type, k.status);
  const total = rows.filter((r) => r.status !== "archived").reduce((sum, r) => sum + r.n, 0);
  const byStatus = (status: string) => rows.filter((r) => r.status === status).reduce((sum, r) => sum + r.n, 0);
  const byType = (type: string) => rows.filter((r) => r.type === type && r.status !== "archived").reduce((sum, r) => sum + r.n, 0);
  return { total, draft: byStatus("draft"), reviewed: byStatus("reviewed"), verified: byStatus("verified"), scenarios: byType("scenario"), patterns: byType("architecture-pattern") };
}
