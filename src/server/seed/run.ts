import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { canonicalJson } from "@/lib/utils";
import { DEMO_EMAIL } from "../constants";
import type { Ctx } from "../ctx";
import { getDb, schema } from "../db";
import { addRelationship, createItem, updateItem } from "../services/knowledge";
import { createProject } from "../services/projects";
import { DEMO_PROJECT } from "./content";
import { LIBRARY } from "./library";

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

const SEEDED_ORIGINS = ["demo-seed", "ai-researched"];

/**
 * Load the starter knowledge library into a workspace. Safe to run again: it adds what is missing and refreshes
 * library items nobody has edited or reviewed. Items a person has changed, reviewed or verified are left alone.
 */
export async function seedKnowledge(ctx: Ctx): Promise<{ items: number; refreshed: number; kept: number; sources: number; relationships: number }> {
  const db = getDb();
  const k = schema.knowledgeItems;
  const sourceIds = new Map<string, string>();
  let sources = 0;
  for (const source of LIBRARY.sources) {
    const [existing] = await db.select().from(schema.sources).where(and(eq(schema.sources.workspaceId, ctx.workspaceId), eq(schema.sources.url, source.url))).limit(1);
    if (existing) {
      sourceIds.set(source.key, existing.id);
      continue;
    }
    // checkedOn is the day the research pass found the page. Base sources were never checked, so it stays null.
    const [created] = await db
      .insert(schema.sources)
      .values({ workspaceId: ctx.workspaceId, title: source.title, url: source.url, publisher: source.publisher, sourceType: source.sourceType, isDemo: source.checkedOn === null, lastVerifiedAt: source.checkedOn ? new Date(`${source.checkedOn}T00:00:00Z`) : null })
      .returning();
    sourceIds.set(source.key, created!.id);
    sources += 1;
  }

  const itemIds = new Map<string, string>();
  let items = 0;
  let refreshed = 0;
  let kept = 0;
  const cite = async (itemId: string, list: { key: string; note: string }[]) => {
    for (const { key, note } of list) {
      const sourceId = sourceIds.get(key);
      if (sourceId) await db.insert(schema.knowledgeItemSources).values({ itemId, sourceId, note: note || null }).onConflictDoNothing();
    }
  };
  for (const seed of LIBRARY.items) {
    const origin = seed.researchedOn ? "ai-researched" : "demo-seed";
    const input = { title: seed.title, type: seed.type as never, summary: seed.summary, sections: seed.sections, attributes: seed.attributes, tags: seed.tags, sourceType: seed.sourceType, confidence: null };
    const [existing] = await db.select().from(k).where(and(eq(k.workspaceId, ctx.workspaceId), eq(k.slug, seed.slug))).limit(1);
    if (!existing) {
      const created = await createItem(ctx, input, { origin, isDemo: !seed.researchedOn, slug: seed.slug });
      itemIds.set(seed.slug, created.id);
      items += 1;
      await cite(created.id, seed.sources);
      continue;
    }
    itemIds.set(seed.slug, existing.id);
    const untouched = SEEDED_ORIGINS.includes(existing.origin) && existing.version === 1 && existing.status === "draft";
    if (!untouched) {
      kept += 1;
      continue;
    }
    if (existing.summary === seed.summary && canonicalJson(existing.sections) === canonicalJson(seed.sections) && canonicalJson(existing.attributes) === canonicalJson(seed.attributes) && existing.origin === origin) continue;
    // Replace the unedited library text in place; version stays 1 because no person's work is being superseded.
    await updateItem(ctx, existing.id, { ...input, expectedVersion: 1, confirmVerifiedEdit: false });
    await db.update(k).set({ version: 1, origin, isDemo: !seed.researchedOn }).where(eq(k.id, existing.id));
    await db.delete(schema.knowledgeItemVersions).where(eq(schema.knowledgeItemVersions.itemId, existing.id));
    await db.delete(schema.knowledgeItemSources).where(eq(schema.knowledgeItemSources.itemId, existing.id));
    await cite(existing.id, seed.sources);
    refreshed += 1;
  }

  let relationships = 0;
  for (const [from, type, to] of LIBRARY.relationships) {
    const fromId = itemIds.get(from);
    const toId = itemIds.get(to);
    if (!fromId || !toId) continue;
    try {
      await addRelationship(ctx, { fromId, toId, type }, "library");
      relationships += 1;
    } catch (error) {
      if (!(error instanceof Error) || !/already exists/.test(error.message)) throw error;
    }
  }
  return { items, refreshed, kept, sources, relationships };
}

export async function seedDemo() {
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
