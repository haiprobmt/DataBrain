import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { DEMO_EMAIL } from "../constants";
import type { Ctx } from "../ctx";
import { getDb, schema } from "../db";
import { addRelationship, attachSource, createItem } from "../services/knowledge";
import { createProject } from "../services/projects";
import { DEMO_PROJECT, SEED_ITEMS, SEED_RELATIONSHIPS, SEED_SOURCES } from "./content";

export async function ensureWorkspace(input: { email: string; name: string; workspaceName: string; isDemo: boolean; passwordHash?: string | null; role?: "owner" | "editor" | "viewer" }): Promise<Ctx> {
  const db = getDb();
  let [user] = await db.select().from(schema.users).where(eq(schema.users.email, input.email)).limit(1);
  if (!user) [user] = await db.insert(schema.users).values({ email: input.email, name: input.name, isDemo: input.isDemo, passwordHash: input.passwordHash ?? null }).returning();
  let [membership] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, user!.id)).limit(1);
  let workspaceId = membership?.workspaceId;
  if (!workspaceId) {
    const [workspace] = await db.insert(schema.workspaces).values({ name: input.workspaceName, isDemo: input.isDemo }).returning();
    workspaceId = workspace!.id;
    [membership] = await db.insert(schema.memberships).values({ userId: user!.id, workspaceId, role: input.role ?? "owner" }).returning();
  }
  const [workspace] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).limit(1);
  return { userId: user!.id, userName: user!.name, userEmail: user!.email, workspaceId, workspaceName: workspace!.name, role: membership!.role, isDemo: workspace!.isDemo, correlationId: randomUUID() };
}

/** Load the demo knowledge base into a workspace. Safe to run twice: existing slugs are skipped. */
export async function seedKnowledge(ctx: Ctx): Promise<{ items: number; sources: number; relationships: number }> {
  const db = getDb();
  const k = schema.knowledgeItems;
  const sourceIds = new Map<string, string>();
  let sources = 0;
  for (const source of SEED_SOURCES) {
    const [existing] = await db.select().from(schema.sources).where(and(eq(schema.sources.workspaceId, ctx.workspaceId), eq(schema.sources.url, source.url))).limit(1);
    if (existing) {
      sourceIds.set(source.key, existing.id);
      continue;
    }
    // lastVerifiedAt stays null: nobody has checked the seed content against these pages.
    const [created] = await db.insert(schema.sources).values({ workspaceId: ctx.workspaceId, title: source.title, url: source.url, publisher: source.publisher, sourceType: source.sourceType, isDemo: true }).returning();
    sourceIds.set(source.key, created!.id);
    sources += 1;
  }

  const itemIds = new Map<string, string>();
  let items = 0;
  for (const seed of SEED_ITEMS) {
    const [existing] = await db.select({ id: k.id }).from(k).where(and(eq(k.workspaceId, ctx.workspaceId), eq(k.slug, seed.slug))).limit(1);
    if (existing) {
      itemIds.set(seed.slug, existing.id);
      continue;
    }
    const created = await createItem(ctx, { title: seed.title, type: seed.type as never, summary: seed.summary, sections: seed.sections, attributes: seed.attributes, tags: seed.tags, sourceType: seed.sourceType, confidence: null }, { origin: "demo-seed", isDemo: true, slug: seed.slug });
    itemIds.set(seed.slug, created.id);
    items += 1;
    for (const key of seed.sources) {
      const sourceId = sourceIds.get(key);
      if (sourceId) await attachSource(ctx, created.id, sourceId, "Documentation home page. The seed text was not checked against it.");
    }
  }

  let relationships = 0;
  for (const [from, type, to] of SEED_RELATIONSHIPS) {
    const fromId = itemIds.get(from);
    const toId = itemIds.get(to);
    if (!fromId || !toId) throw new Error(`Seed relationship refers to a missing item: ${from} ${type} ${to}`);
    try {
      await addRelationship(ctx, { fromId, toId, type }, "demo-seed");
      relationships += 1;
    } catch (error) {
      if (!(error instanceof Error) || !/already exists/.test(error.message)) throw error;
    }
  }
  return { items, sources, relationships };
}

export async function seedDemo(): Promise<{ ctx: Ctx; items: number; sources: number; relationships: number }> {
  const ctx = await ensureWorkspace({ email: DEMO_EMAIL, name: "Demo Architect", workspaceName: "DataLabsIQ Demo Workspace", isDemo: true });
  const result = await seedKnowledge(ctx);
  const db = getDb();
  const [project] = await db.select().from(schema.projects).where(and(eq(schema.projects.workspaceId, ctx.workspaceId), eq(schema.projects.name, DEMO_PROJECT.name))).limit(1);
  if (!project) {
    const created = await createProject(ctx, DEMO_PROJECT);
    await db.update(schema.projects).set({ isDemo: true }).where(eq(schema.projects.id, created.id));
  }
  return { ctx, ...result };
}
