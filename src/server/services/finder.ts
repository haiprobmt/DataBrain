import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { DEFAULT_WEIGHTS } from "@/lib/catalog";
import { autoLayout } from "@/lib/diagram";
import { scoreScenario, type RequirementProfile } from "@/lib/scoring";
import type { DiagramModel, FinderWeights } from "@/lib/types";
import { uniq } from "@/lib/utils";
import { tokenLabel } from "@/lib/vocab";
import { audit } from "../audit";
import { assertCanEdit, type Ctx } from "../ctx";
import { getDb, schema } from "../db";
import { notFound, precondition } from "../errors";
import { getItemSources, search } from "./knowledge";
import { getProject, getRequirements, type Requirement } from "./projects";

const c = schema.architectureCandidates;
export type Candidate = typeof c.$inferSelect;

export function toProfile(requirements: Requirement[]): RequirementProfile {
  return Object.fromEntries(requirements.map((r) => [r.field, { state: r.state, value: r.value, tokens: r.tokens }]));
}

export async function effectiveWeights(ctx: Ctx, projectId: string): Promise<FinderWeights> {
  const project = await getProject(ctx, projectId);
  if (project.weights) return project.weights;
  const [ws] = await getDb().select({ settings: schema.workspaces.settings }).from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId)).limit(1);
  return ws?.settings.defaultWeights ?? DEFAULT_WEIGHTS;
}

/** A generic layered proposal, used only when no stored scenario survives the hard filters. */
function generatedDiagram(profile: RequirementProfile): DiagramModel {
  const sources = profile.source_systems?.tokens.length ? profile.source_systems.tokens.map(tokenLabel) : ["Source systems (TODO: confirm)"];
  const prov = { origin: "generated" as const, note: "Composed by the local rules engine; not taken from a reference scenario." };
  const base = { description: "", config: {}, provenance: prov };
  const nodes = autoLayout([
    ...sources.slice(0, 4).map((label, i) => ({ ...base, id: `source-${i + 1}`, kind: "source" as const, label, requirementFields: ["source_systems"] })),
    { ...base, id: "ingestion", kind: "ingestion", label: "Ingestion", description: "Batch or streaming ingestion — technology to be selected.", requirementFields: ["latency"] },
    { ...base, id: "storage", kind: "storage", label: "Governed storage", description: "Raw, cleansed and curated zones — technology to be selected.", requirementFields: ["data_volume"] },
    { ...base, id: "processing", kind: "processing", label: "Transformation", description: "Transformation engine — technology to be selected.", requirementFields: ["workloads"] },
    { ...base, id: "serving", kind: "serving", label: "Serving layer", description: "Semantic or query layer for consumers.", requirementFields: ["workloads", "users"] },
    { ...base, id: "consumers", kind: "consumer", label: "Consumers", description: "Reports, applications and data science users.", requirementFields: ["users"] },
  ]);
  const edge = (source: string, target: string, label: string) => ({ id: `${source}__${target}`, source, target, label, kind: "data" as const, provenance: prov });
  return {
    nodes,
    edges: [
      ...nodes.filter((n) => n.kind === "source").map((n) => edge(n.id, "ingestion", "extract")),
      edge("ingestion", "storage", "land"),
      edge("storage", "processing", "transform"),
      edge("processing", "serving", "publish"),
      edge("serving", "consumers", "query"),
    ],
  };
}

export async function runFinder(ctx: Ctx, projectId: string, weightsInput?: FinderWeights) {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  if (project.requirementsStatus !== "approved") {
    throw precondition("Review and approve the requirements before ranking architectures.");
  }
  const requirements = await getRequirements(ctx, projectId);
  const profile = toProfile(requirements);
  const weights = weightsInput ?? (await effectiveWeights(ctx, projectId));
  const db = getDb();
  const k = schema.knowledgeItems;

  // 1. Candidate pool: every non-archived scenario in the workspace.
  const scenarios = await db.select().from(k).where(and(eq(k.workspaceId, ctx.workspaceId), eq(k.type, "scenario"), ne(k.status, "archived")));

  // 2. Lexical + semantic retrieval over the project text: explains similarity and breaks score ties.
  const queryText = [project.name, project.description, ...requirements.filter((r) => r.state === "known").map((r) => r.value)].join(" ").slice(0, 1500);
  const retrieval = await search(ctx, queryText, { types: ["scenario"], limit: 40 });
  const similarity = new Map(retrieval.map((hit) => [hit.item.id, hit]));

  // 3. Hard filters + explainable scoring.
  const scored = scenarios.map((scenario) => ({ scenario, result: scoreScenario(profile, { id: scenario.id, title: scenario.title, status: scenario.status, attributes: scenario.attributes }, weights) }));
  const excluded = scored.filter((s) => s.result.excluded).map((s) => ({ id: s.scenario.id, title: s.scenario.title, reason: s.result.excluded! }));
  const kept = scored
    .filter((s) => !s.result.excluded)
    .sort((a, b) => b.result.score - a.result.score || (similarity.get(b.scenario.id)?.score ?? 0) - (similarity.get(a.scenario.id)?.score ?? 0))
    .slice(0, 6);

  // 4. Graph expansion: patterns, technologies, practices and strategies connected to each kept scenario.
  const keptIds = kept.map((s) => s.scenario.id);
  const r = schema.relationships;
  const edges = keptIds.length ? await db.select().from(r).where(and(eq(r.workspaceId, ctx.workspaceId), or(inArray(r.fromId, keptIds), inArray(r.toId, keptIds)))) : [];
  const relatedOf = (id: string) => uniq(edges.filter((e) => e.fromId === id || e.toId === id).map((e) => (e.fromId === id ? e.toId : e.fromId)));
  const allRelated = uniq(keptIds.flatMap(relatedOf));
  const sourceRows = await getItemSources(ctx, [...keptIds, ...allRelated]);

  const [last] = await db.select({ run: sql<number>`coalesce(max(${c.run}), 0)::int` }).from(c).where(eq(c.projectId, project.id));
  const run = (last?.run ?? 0) + 1;

  const rows: (typeof c.$inferInsert)[] = kept.map(({ scenario, result }, index) => {
    const related = relatedOf(scenario.id);
    const hit = similarity.get(scenario.id);
    const diagram = scenario.attributes.diagram ?? { nodes: [], edges: [] };
    return {
      projectId: project.id,
      run,
      rank: index + 1,
      scenarioId: scenario.id,
      title: scenario.title,
      summary: scenario.summary,
      label: result.label,
      score: result.score,
      confidence: result.confidence,
      factors: result.factors,
      weights,
      gaps: result.gaps,
      tradeoffs: [...(scenario.attributes.tradeoffs ?? []), ...(scenario.attributes.limitations ?? []).map((l) => `Limitation: ${l}`)],
      assumptions: result.assumptions,
      costDrivers: scenario.attributes.costDrivers ?? [],
      matchReasons: [...result.matchReasons, ...(hit ? hit.why.map((w) => `Text similarity — ${w}`) : [])],
      relatedItemIds: related,
      sourceIds: uniq(sourceRows.filter((s) => s.itemId === scenario.id || related.includes(s.itemId)).map((s) => s.source.id)),
      diagram: {
        nodes: diagram.nodes.map((n) => ({ ...n, provenance: { origin: "reference" as const, itemId: scenario.id } })),
        edges: diagram.edges.map((e) => ({ ...e, provenance: { origin: "reference" as const, itemId: scenario.id } })),
      },
      generator: "local-rules/scoring-v1",
    };
  });

  if (rows.length === 0) {
    rows.push({
      projectId: project.id,
      run,
      rank: 1,
      scenarioId: null,
      title: "Generated proposal: layered analytics platform",
      summary: "No stored scenario passed the platform filter, so this is a generic layered outline composed by the local rules engine. It names no products and has not been validated. Add or import a matching scenario to get a reference-based recommendation.",
      label: "generated-proposal",
      score: 0,
      confidence: 0,
      factors: [],
      weights,
      gaps: ["No reference scenario matches the stated target platform.", ...excluded.map((e) => `${e.title}: ${e.reason}`)],
      tradeoffs: [],
      assumptions: ["Every component and technology choice in this outline is unvalidated."],
      costDrivers: [],
      matchReasons: [],
      relatedItemIds: [],
      sourceIds: [],
      diagram: generatedDiagram(profile),
      generator: "local-rules/outline-v1",
    });
  }

  const inserted = await db.transaction(async (tx) => {
    await tx.update(schema.projects).set({ weights }).where(eq(schema.projects.id, project.id));
    const out = await tx.insert(c).values(rows).returning();
    await audit(ctx, { action: "finder.run", entityType: "project", entityId: project.id, projectId: project.id, summary: `Architecture Finder run ${run}: ${out.length} candidate(s), ${excluded.length} filtered out`, metadata: { run, weights, excluded } }, tx);
    return out;
  });
  return { run, candidates: inserted, excluded };
}

export async function listCandidates(ctx: Ctx, projectId: string, run?: number) {
  const project = await getProject(ctx, projectId);
  const db = getDb();
  const [last] = await db.select({ run: sql<number>`coalesce(max(${c.run}), 0)::int` }).from(c).where(eq(c.projectId, project.id));
  const targetRun = run ?? last?.run ?? 0;
  const candidates = targetRun ? await db.select().from(c).where(and(eq(c.projectId, project.id), eq(c.run, targetRun))).orderBy(c.rank) : [];
  const [event] = await db
    .select({ metadata: schema.auditEvents.metadata, createdAt: schema.auditEvents.createdAt })
    .from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.projectId, project.id), eq(schema.auditEvents.action, "finder.run"), sql`(${schema.auditEvents.metadata}->>'run')::int = ${targetRun}`))
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(1);
  const excluded = ((event?.metadata.excluded as { id: string; title: string; reason: string }[] | undefined) ?? []);
  return { run: targetRun, latestRun: last?.run ?? 0, candidates, excluded, ranAt: event?.createdAt ?? null };
}

export async function getCandidate(ctx: Ctx, projectId: string, candidateId: string): Promise<Candidate> {
  const project = await getProject(ctx, projectId);
  const [candidate] = await getDb().select().from(c).where(and(eq(c.id, candidateId), eq(c.projectId, project.id))).limit(1);
  if (!candidate) throw notFound("Candidate");
  return candidate;
}
