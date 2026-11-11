import { and, desc, eq, sql } from "drizzle-orm";
import type { FinderWeights } from "@/lib/types";
import { audit } from "../audit";
import type { Ctx } from "../ctx";
import { getDb, schema } from "../db";
import { env } from "../env";
import { forbidden } from "../errors";

export async function recentActivity(ctx: Ctx, options: { limit?: number; projectId?: string } = {}) {
  const e = schema.auditEvents;
  return getDb()
    .select({ id: e.id, action: e.action, entityType: e.entityType, entityId: e.entityId, projectId: e.projectId, summary: e.summary, createdAt: e.createdAt, actor: schema.users.name })
    .from(e)
    .leftJoin(schema.users, eq(schema.users.id, e.actorId))
    .where(and(eq(e.workspaceId, ctx.workspaceId), options.projectId ? eq(e.projectId, options.projectId) : undefined))
    .orderBy(desc(e.createdAt))
    .limit(options.limit ?? 12);
}

export async function getWorkspace(ctx: Ctx) {
  const [ws] = await getDb().select().from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId)).limit(1);
  return { workspace: ws!, freshnessPolicyDays: ws!.settings.freshnessPolicyDays ?? env.freshnessPolicyDays };
}

export async function updateSettings(ctx: Ctx, input: { workspaceName?: string; freshnessPolicyDays?: number; defaultWeights?: FinderWeights }) {
  if (ctx.role !== "owner") throw forbidden("Only a workspace owner can change settings.");
  const { workspace } = await getWorkspace(ctx);
  const settings = { ...workspace.settings, ...(input.freshnessPolicyDays ? { freshnessPolicyDays: input.freshnessPolicyDays } : {}), ...(input.defaultWeights ? { defaultWeights: input.defaultWeights } : {}) };
  await getDb().update(schema.workspaces).set({ name: input.workspaceName ?? workspace.name, settings }).where(eq(schema.workspaces.id, workspace.id));
  await audit(ctx, { action: "settings.update", entityType: "workspace", entityId: workspace.id, summary: "Updated workspace settings" });
}

export async function projectStats(ctx: Ctx) {
  const [row] = await getDb()
    .select({
      active: sql<number>`count(*) filter (where ${schema.projects.status} = 'active')::int`,
      approved: sql<number>`count(*) filter (where exists (select 1 from ${schema.architectureRevisions} a where a.project_id = ${schema.projects.id} and a.status = 'approved'))::int`,
    })
    .from(schema.projects)
    .where(eq(schema.projects.workspaceId, ctx.workspaceId));
  return { active: row?.active ?? 0, approved: row?.approved ?? 0 };
}
