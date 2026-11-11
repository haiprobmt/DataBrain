import { and, desc, eq, sql } from "drizzle-orm";
import { INTAKE_FIELDS, intakeField } from "@/lib/intake";
import type { FinderWeights } from "@/lib/types";
import { tokensForField } from "@/lib/vocab";
import { audit } from "../audit";
import { assertCanEdit, type Ctx } from "../ctx";
import { getDb, schema } from "../db";
import { AppError, notFound, precondition } from "../errors";
import { getLLM } from "../providers";

const p = schema.projects;
export type Project = typeof p.$inferSelect;
export type Requirement = typeof schema.requirements.$inferSelect;
export type Environment = typeof schema.environments.$inferSelect;

/** Every project-scoped service starts here: a project outside the caller's workspace does not exist for them. */
export async function getProject(ctx: Ctx, projectId: string): Promise<Project> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw notFound("Project");
  const [project] = await getDb().select().from(p).where(and(eq(p.id, projectId), eq(p.workspaceId, ctx.workspaceId))).limit(1);
  if (!project) throw notFound("Project");
  return project;
}

export async function listProjects(ctx: Ctx, options: { includeArchived?: boolean } = {}) {
  return getDb()
    .select({
      project: p,
      requirementCount: sql<number>`(select count(*)::int from ${schema.requirements} r where r.project_id = ${p.id} and r.state = 'known')`,
      revisionCount: sql<number>`(select count(*)::int from ${schema.architectureRevisions} a where a.project_id = ${p.id})`,
      approvedVersion: sql<number | null>`(select max(a.version) from ${schema.architectureRevisions} a where a.project_id = ${p.id} and a.status = 'approved')`,
    })
    .from(p)
    .where(and(eq(p.workspaceId, ctx.workspaceId), options.includeArchived ? undefined : eq(p.status, "active")))
    .orderBy(desc(p.updatedAt));
}

export async function createProject(ctx: Ctx, input: { name: string; description: string; context: string }) {
  assertCanEdit(ctx);
  const [project] = await getDb().insert(p).values({ workspaceId: ctx.workspaceId, ownerId: ctx.userId, ...input }).returning();
  await audit(ctx, { action: "project.create", entityType: "project", entityId: project!.id, projectId: project!.id, summary: `Created project “${input.name}”` });
  return project!;
}

export async function updateProject(ctx: Ctx, projectId: string, input: { name: string; description: string; context: string }) {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const [updated] = await getDb().update(p).set(input).where(eq(p.id, project.id)).returning();
  await audit(ctx, { action: "project.update", entityType: "project", entityId: project.id, projectId: project.id, summary: `Updated project “${input.name}”` });
  return updated!;
}

export async function setProjectStatus(ctx: Ctx, projectId: string, status: Project["status"]) {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const [updated] = await getDb().update(p).set({ status }).where(eq(p.id, project.id)).returning();
  await audit(ctx, { action: `project.${status === "archived" ? "archive" : "restore"}`, entityType: "project", entityId: project.id, projectId: project.id, summary: `${status === "archived" ? "Archived" : "Restored"} project “${project.name}”` });
  return updated!;
}

export async function saveWeights(ctx: Ctx, projectId: string, weights: FinderWeights) {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  await getDb().update(p).set({ weights }).where(eq(p.id, project.id));
}

// ── Requirements ────────────────────────────────────────────────────────────
export async function getRequirements(ctx: Ctx, projectId: string): Promise<Requirement[]> {
  const project = await getProject(ctx, projectId);
  const rows = await getDb().select().from(schema.requirements).where(eq(schema.requirements.projectId, project.id));
  const order = new Map(INTAKE_FIELDS.map((f, i) => [f.key, i]));
  return rows.sort((a, b) => (order.get(a.field) ?? 99) - (order.get(b.field) ?? 99));
}

/**
 * Run the configured provider over the project context and store the result as draft requirements.
 * Rows the user has typed or edited are kept; only extracted or empty rows are refreshed.
 */
export async function extractRequirements(ctx: Ctx, projectId: string) {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  if (project.context.trim().length < 20) {
    throw new AppError("validation_error", "Describe the project in a few sentences before extracting requirements.", { context: ["Add at least 20 characters of project context."] });
  }
  const llm = getLLM();
  const extraction = await llm.extractRequirements(project.context);
  const db = getDb();
  const existing = await db.select().from(schema.requirements).where(eq(schema.requirements.projectId, project.id));
  const userOwned = new Set(existing.filter((r) => r.origin === "user" && r.state !== "unknown").map((r) => r.field));

  await db.transaction(async (tx) => {
    for (const fact of extraction.facts) {
      if (userOwned.has(fact.field)) continue;
      const row = { projectId: project.id, field: fact.field, state: "known" as const, value: fact.value, tokens: fact.tokens, kind: fact.confidence < 0.6 ? ("assumption" as const) : ("fact" as const), evidence: fact.evidence, origin: "extracted" as const, confidence: fact.confidence, question: null };
      await tx.insert(schema.requirements).values(row).onConflictDoUpdate({ target: [schema.requirements.projectId, schema.requirements.field], set: row });
    }
    for (const miss of extraction.missing) {
      if (userOwned.has(miss.field)) continue;
      const row = { projectId: project.id, field: miss.field, state: "unknown" as const, value: "", tokens: [] as string[], kind: "unknown" as const, evidence: null, origin: "extracted" as const, confidence: null, question: miss.question };
      await tx.insert(schema.requirements).values(row).onConflictDoUpdate({ target: [schema.requirements.projectId, schema.requirements.field], set: row });
    }
    await tx.update(p).set({ requirementsStatus: "draft", requirementsApprovedAt: null }).where(eq(p.id, project.id));
    await audit(ctx, { action: "requirements.extract", entityType: "project", entityId: project.id, projectId: project.id, summary: `Extracted ${extraction.facts.length} requirement(s) with ${extraction.provider}; ${extraction.missing.length} unknown`, metadata: { provider: extraction.provider, model: extraction.model } }, tx);
  });
  return { extraction, keptUserFields: [...userOwned] };
}

export async function saveRequirements(ctx: Ctx, projectId: string, rows: { field: string; state: Requirement["state"]; value: string; kind?: Requirement["kind"] }[]) {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const fieldErrors: Record<string, string[]> = {};
  for (const row of rows) {
    if (!intakeField(row.field)) fieldErrors[row.field] = ["Unknown requirement field."];
    else if (row.state === "known" && !row.value.trim()) fieldErrors[row.field] = ["Enter a value, or mark the field unknown or not applicable."];
  }
  if (Object.keys(fieldErrors).length) throw new AppError("validation_error", "Some requirements are incomplete.", fieldErrors);

  const db = getDb();
  const existing = await db.select().from(schema.requirements).where(eq(schema.requirements.projectId, project.id));
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const before = existing.find((r) => r.field === row.field);
      const value = row.state === "known" ? row.value.trim() : "";
      const changed = !before || before.value !== value || before.state !== row.state;
      const kind = row.state === "known" ? (row.kind === "assumption" ? "assumption" : "fact") : row.state === "unknown" ? "unknown" : "fact";
      const next = {
        projectId: project.id,
        field: row.field,
        state: row.state,
        value,
        tokens: row.state === "known" ? tokensForField(row.field, value) : [],
        kind: kind as Requirement["kind"],
        // An unchanged extracted row keeps its evidence; a user edit replaces it.
        origin: changed ? ("user" as const) : (before?.origin ?? "user"),
        evidence: changed ? null : (before?.evidence ?? null),
        confidence: changed ? null : (before?.confidence ?? null),
        question: row.state === "unknown" ? (intakeField(row.field)?.question ?? null) : null,
      };
      await tx.insert(schema.requirements).values(next).onConflictDoUpdate({ target: [schema.requirements.projectId, schema.requirements.field], set: next });
    }
    // Any edit invalidates a previous approval.
    await tx.update(p).set({ requirementsStatus: "draft", requirementsApprovedAt: null }).where(eq(p.id, project.id));
    await audit(ctx, { action: "requirements.save", entityType: "project", entityId: project.id, projectId: project.id, summary: `Saved ${rows.length} requirement(s)` }, tx);
  });
  return getRequirements(ctx, projectId);
}

export async function approveRequirements(ctx: Ctx, projectId: string) {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const rows = await getRequirements(ctx, projectId);
  if (!rows.some((r) => r.state === "known")) throw precondition("Record at least one known requirement before approving.");
  const [updated] = await getDb().update(p).set({ requirementsStatus: "approved", requirementsApprovedAt: new Date() }).where(eq(p.id, project.id)).returning();
  const unknown = rows.filter((r) => r.state === "unknown").length;
  await audit(ctx, { action: "requirements.approve", entityType: "project", entityId: project.id, projectId: project.id, summary: `Approved requirements (${rows.length - unknown} stated, ${unknown} unknown)` });
  return updated!;
}

// ── Environments ────────────────────────────────────────────────────────────
export async function listEnvironments(ctx: Ctx, projectId: string) {
  const project = await getProject(ctx, projectId);
  return getDb().select().from(schema.environments).where(eq(schema.environments.projectId, project.id)).orderBy(schema.environments.createdAt);
}

export async function getEnvironment(ctx: Ctx, projectId: string, environmentId: string) {
  const project = await getProject(ctx, projectId);
  const [environment] = await getDb().select().from(schema.environments).where(and(eq(schema.environments.id, environmentId), eq(schema.environments.projectId, project.id))).limit(1);
  if (!environment) throw notFound("Environment");
  return environment;
}

export async function createEnvironment(ctx: Ctx, projectId: string, input: { name: string; kind: Environment["kind"]; platform: string; notes: string }) {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const [environment] = await getDb().insert(schema.environments).values({ projectId: project.id, ...input }).returning();
  await audit(ctx, { action: "environment.create", entityType: "environment", entityId: environment!.id, projectId: project.id, summary: `Added ${input.kind} environment “${input.name}”` });
  return environment!;
}
