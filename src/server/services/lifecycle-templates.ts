import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { DEFAULT_LIFECYCLE_TEMPLATE, DEFAULT_TEMPLATE_NAME, normalizeReadinessRules, type ChecklistItemType, type ReadinessRule, type TemplateStageDef } from "@/lib/lifecycle";
import type { TemplateCreateInput, TemplateUpdateInput } from "@/lib/lifecycle-schemas";
import { audit } from "../audit";
import { assertCanEdit, type Ctx } from "../ctx";
import { getDb, schema, type Tx } from "../db";
import { AppError, conflict, forbidden, notFound, precondition } from "../errors";

const t = schema.lifecycleTemplates;
const sd = schema.lifecycleStageDefinitions;
const cd = schema.lifecycleChecklistDefinitions;
export type LifecycleTemplate = typeof t.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TemplateStageView {
  id: string;
  stageKey: string;
  name: string;
  description: string;
  sortOrder: number;
  isRequired: boolean;
  requiresApproval: boolean;
  defaultDurationDays: number | null;
  readinessRules: ReadinessRule[];
  checklist: { id: string; title: string; description: string; sortOrder: number; isRequired: boolean; itemType: ChecklistItemType }[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  version: number;
  isDefault: boolean;
  isActive: boolean;
  /** Provisioned by DataBrain rather than created by a member. */
  builtIn: boolean;
  stageCount: number;
  /** Projects whose lifecycle was started from this template. They hold snapshots and are not affected by edits. */
  projectCount: number;
  updatedAt: string;
}

export interface TemplateView extends TemplateSummary {
  stages: TemplateStageView[];
}

type StageInput = Omit<TemplateStageDef, "checklist"> & { checklist: { title: string; description?: string; itemType: ChecklistItemType; isRequired: boolean }[] };

async function insertDefinitions(tx: Tx, templateId: string, stages: StageInput[]): Promise<void> {
  for (const [index, stage] of stages.entries()) {
    const [row] = await tx
      .insert(sd)
      .values({
        templateId,
        stageKey: stage.stageKey,
        name: stage.name,
        description: stage.description,
        sortOrder: index + 1,
        isRequired: stage.isRequired,
        requiresApproval: stage.requiresApproval,
        defaultDurationDays: stage.defaultDurationDays,
        readinessRules: normalizeReadinessRules(stage.readinessRules, stage.requiresApproval),
      })
      .returning({ id: sd.id });
    if (stage.checklist.length) {
      await tx.insert(cd).values(stage.checklist.map((c, i) => ({ stageDefinitionId: row!.id, title: c.title, description: c.description ?? "", sortOrder: i + 1, isRequired: c.isRequired, itemType: c.itemType })));
    }
  }
}

/**
 * Template changes in one workspace are serialised with an advisory lock, so name uniqueness, the single default
 * and "the default cannot be deactivated" are checked against the state the change is applied to.
 */
async function withTemplateLock<T>(workspaceId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lifecycle-template:${workspaceId}`}))`);
    return work(tx);
  });
}

/**
 * Make sure the workspace has an active default template, creating the built-in one when it has none.
 * Idempotent and safe under concurrency (advisory lock per workspace), so it can run at workspace creation
 * and lazily before any read or lifecycle start in workspaces that existed before this feature.
 */
export async function ensureDefaultLifecycleTemplate(ctx: Pick<Ctx, "userId" | "workspaceId" | "correlationId">): Promise<LifecycleTemplate> {
  const db = getDb();
  const activeDefault = and(eq(t.workspaceId, ctx.workspaceId), eq(t.isDefault, true), eq(t.isActive, true));
  const [existing] = await db.select().from(t).where(activeDefault).limit(1);
  if (existing) return existing;

  return withTemplateLock(ctx.workspaceId, async (tx) => {
    const [again] = await tx.select().from(t).where(activeDefault).limit(1);
    if (again) return again;
    const [named] = await tx.select().from(t).where(and(eq(t.workspaceId, ctx.workspaceId), eq(t.name, DEFAULT_TEMPLATE_NAME))).limit(1);
    if (named) {
      const [promoted] = await tx.update(t).set({ isDefault: true, isActive: true }).where(eq(t.id, named.id)).returning();
      return promoted!;
    }
    const [created] = await tx.insert(t).values({ workspaceId: ctx.workspaceId, name: DEFAULT_LIFECYCLE_TEMPLATE.name, description: DEFAULT_LIFECYCLE_TEMPLATE.description, isDefault: true, isActive: true, createdBy: null }).returning();
    await insertDefinitions(tx, created!.id, DEFAULT_LIFECYCLE_TEMPLATE.stages);
    await audit(ctx, { action: "lifecycle.template.provision", entityType: "lifecycle_template", entityId: created!.id, summary: `Provisioned the built-in lifecycle template “${created!.name}”`, metadata: { stages: DEFAULT_LIFECYCLE_TEMPLATE.stages.length } }, tx);
    return created!;
  });
}

async function loadTemplate(ctx: Ctx, templateId: string, tx: Tx = getDb()): Promise<LifecycleTemplate> {
  if (!UUID.test(templateId)) throw notFound("Lifecycle template");
  const [template] = await tx.select().from(t).where(and(eq(t.id, templateId), eq(t.workspaceId, ctx.workspaceId))).limit(1);
  if (!template) throw notFound("Lifecycle template");
  return template;
}

/** Stage and checklist definitions of one template, in order. The caller must already have verified the template's workspace. */
export async function loadTemplateStages(templateId: string, tx: Tx = getDb()): Promise<TemplateStageView[]> {
  const stages = await tx.select().from(sd).where(eq(sd.templateId, templateId)).orderBy(asc(sd.sortOrder));
  const items = stages.length ? await tx.select().from(cd).where(inArray(cd.stageDefinitionId, stages.map((s) => s.id))).orderBy(asc(cd.sortOrder)) : [];
  return stages.map((s) => ({
    id: s.id,
    stageKey: s.stageKey,
    name: s.name,
    description: s.description,
    sortOrder: s.sortOrder,
    isRequired: s.isRequired,
    requiresApproval: s.requiresApproval,
    defaultDurationDays: s.defaultDurationDays,
    readinessRules: s.readinessRules,
    checklist: items.filter((i) => i.stageDefinitionId === s.id).map((i) => ({ id: i.id, title: i.title, description: i.description, sortOrder: i.sortOrder, isRequired: i.isRequired, itemType: i.itemType })),
  }));
}

const summary = (row: LifecycleTemplate, stageCount: number, projectCount: number): TemplateSummary => ({
  id: row.id,
  name: row.name,
  description: row.description,
  version: row.version,
  isDefault: row.isDefault,
  isActive: row.isActive,
  builtIn: row.createdBy === null,
  stageCount,
  projectCount,
  updatedAt: row.updatedAt.toISOString(),
});

export async function listLifecycleTemplates(ctx: Ctx): Promise<TemplateSummary[]> {
  await ensureDefaultLifecycleTemplate(ctx);
  const rows = await getDb()
    .select({
      template: t,
      // The outer column is written qualified: Drizzle renders `${t.id}` as a bare "id" here, which would bind to the inner table.
      stageCount: sql<number>`(select count(*)::int from ${sd} d where d.template_id = ${t}."id")`,
      projectCount: sql<number>`(select count(*)::int from ${schema.projectLifecycles} pl where pl.template_id = ${t}."id")`,
    })
    .from(t)
    .where(eq(t.workspaceId, ctx.workspaceId))
    .orderBy(sql`${t.isDefault} desc`, sql`${t.isActive} desc`, asc(t.name));
  return rows.map((r) => summary(r.template, r.stageCount, r.projectCount));
}

export async function getLifecycleTemplate(ctx: Ctx, templateId: string): Promise<TemplateView> {
  const template = await loadTemplate(ctx, templateId);
  const [stages, [usage]] = await Promise.all([
    loadTemplateStages(template.id),
    getDb().select({ n: sql<number>`count(*)::int` }).from(schema.projectLifecycles).where(eq(schema.projectLifecycles.templateId, template.id)),
  ]);
  return { ...summary(template, stages.length, usage?.n ?? 0), stages };
}

async function assertNameFree(ctx: Ctx, name: string, exceptId: string | null, tx: Tx): Promise<void> {
  const [clash] = await tx.select({ id: t.id }).from(t).where(and(eq(t.workspaceId, ctx.workspaceId), sql`lower(${t.name}) = lower(${name})`)).limit(1);
  if (clash && clash.id !== exceptId) throw new AppError("conflict", "A lifecycle template with this name already exists in the workspace.", { name: ["Choose a different name."] });
}

/** Create a custom template: from explicit stages, as a copy of another template, or as a copy of the workspace default. */
export async function createLifecycleTemplate(ctx: Ctx, input: TemplateCreateInput): Promise<TemplateView> {
  assertCanEdit(ctx);
  const source = input.stages ? null : input.fromTemplateId ? await loadTemplate(ctx, input.fromTemplateId) : await ensureDefaultLifecycleTemplate(ctx);
  const stages: StageInput[] = input.stages ?? (await loadTemplateStages(source!.id));
  const created = await withTemplateLock(ctx.workspaceId, async (tx) => {
    await assertNameFree(ctx, input.name, null, tx);
    const [row] = await tx.insert(t).values({ workspaceId: ctx.workspaceId, name: input.name, description: input.description, createdBy: ctx.userId }).returning();
    await insertDefinitions(tx, row!.id, stages);
    await audit(ctx, { action: "lifecycle.template.create", entityType: "lifecycle_template", entityId: row!.id, summary: `Created lifecycle template “${row!.name}”${source ? ` from “${source.name}”` : ""}`, metadata: { stages: stages.length, fromTemplateId: source?.id ?? null } }, tx);
    return row!;
  });
  return getLifecycleTemplate(ctx, created.id);
}

/**
 * Replace a template's name, stages and checklists and bump its version. Projects are never touched: each
 * lifecycle holds its own snapshot of the stages and checklist it was started with.
 */
export async function updateLifecycleTemplate(ctx: Ctx, templateId: string, input: TemplateUpdateInput): Promise<TemplateView> {
  assertCanEdit(ctx);
  await loadTemplate(ctx, templateId);
  await withTemplateLock(ctx.workspaceId, async (tx) => {
    const template = await loadTemplate(ctx, templateId, tx);
    if (template.isDefault && ctx.role !== "owner") throw forbidden("Only a workspace owner can change the default lifecycle template.");
    await assertNameFree(ctx, input.name, template.id, tx);
    const [updated] = await tx
      .update(t)
      .set({ name: input.name, description: input.description, version: template.version + 1 })
      .where(and(eq(t.id, template.id), eq(t.version, input.expectedVersion)))
      .returning({ id: t.id });
    if (!updated) throw conflict("This template was changed since you opened it. Reload to see the latest version before saving again.", { currentVersion: template.version });
    await tx.delete(sd).where(eq(sd.templateId, template.id));
    await insertDefinitions(tx, template.id, input.stages);
    await audit(ctx, { action: "lifecycle.template.update", entityType: "lifecycle_template", entityId: template.id, summary: `Updated lifecycle template “${input.name}” to version ${template.version + 1}`, metadata: { version: template.version + 1, stages: input.stages.length } }, tx);
  });
  return getLifecycleTemplate(ctx, templateId);
}

export async function setDefaultLifecycleTemplate(ctx: Ctx, templateId: string): Promise<TemplateSummary> {
  if (ctx.role !== "owner") throw forbidden("Only a workspace owner can change the default lifecycle template.");
  await loadTemplate(ctx, templateId);
  await withTemplateLock(ctx.workspaceId, async (tx) => {
    const template = await loadTemplate(ctx, templateId, tx);
    if (!template.isActive) throw precondition("Reactivate this template before making it the default.");
    if (template.isDefault) return;
    // Clear first: the partial unique index allows one active default per workspace.
    await tx.update(t).set({ isDefault: false }).where(and(eq(t.workspaceId, ctx.workspaceId), eq(t.isDefault, true)));
    await tx.update(t).set({ isDefault: true }).where(eq(t.id, template.id));
    await audit(ctx, { action: "lifecycle.template.default", entityType: "lifecycle_template", entityId: template.id, summary: `Made “${template.name}” the default lifecycle template` }, tx);
  });
  return getLifecycleTemplate(ctx, templateId);
}

/** Deactivate (archive) or reactivate a template. The default cannot be deactivated: choose another default first. */
export async function setLifecycleTemplateActive(ctx: Ctx, templateId: string, isActive: boolean): Promise<TemplateSummary> {
  assertCanEdit(ctx);
  await loadTemplate(ctx, templateId);
  await withTemplateLock(ctx.workspaceId, async (tx) => {
    const template = await loadTemplate(ctx, templateId, tx);
    if (!isActive && template.isDefault) throw precondition("This is the workspace default. Make another template the default before deactivating it.");
    if (template.isActive === isActive) return;
    await tx.update(t).set({ isActive }).where(eq(t.id, template.id));
    await audit(ctx, { action: isActive ? "lifecycle.template.reactivate" : "lifecycle.template.deactivate", entityType: "lifecycle_template", entityId: template.id, summary: `${isActive ? "Reactivated" : "Deactivated"} lifecycle template “${template.name}”` }, tx);
  });
  return getLifecycleTemplate(ctx, templateId);
}

/** The template a new lifecycle starts from: the one asked for (it must be active), or the workspace default. */
export async function resolveTemplateForStart(ctx: Ctx, templateId?: string): Promise<LifecycleTemplate> {
  if (!templateId) return ensureDefaultLifecycleTemplate(ctx);
  const template = await loadTemplate(ctx, templateId);
  if (!template.isActive) throw precondition(`“${template.name}” is deactivated and cannot start new lifecycles.`);
  return template;
}
