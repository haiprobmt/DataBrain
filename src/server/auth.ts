import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { hmac, safeEqual, verifyPassword } from "./crypto";
import { getDb, schema } from "./db";
import { env } from "./env";
import type { Ctx } from "./ctx";
import { AppError } from "./errors";

export const SESSION_COOKIE = "databrain_session";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
export { DEMO_EMAIL } from "./constants";
import { DEMO_EMAIL } from "./constants";

export type { Ctx } from "./ctx";
export { assertCanEdit } from "./ctx";

export function signSession(userId: string, workspaceId: string, expiresAt: number): string {
  const payload = `${userId}.${workspaceId}.${expiresAt}`;
  return `${payload}.${hmac(env.sessionSecret, payload)}`;
}

export function verifySession(token: string | undefined, now = Date.now()): { userId: string; workspaceId: string } | null {
  if (!token) return null;
  const [userId, workspaceId, exp, sig] = token.split(".");
  if (!userId || !workspaceId || !exp || !sig) return null;
  if (!safeEqual(hmac(env.sessionSecret, `${userId}.${workspaceId}.${exp}`), sig)) return null;
  if (Number(exp) < now) return null;
  return { userId, workspaceId };
}

async function loadCtx(userId: string, workspaceId: string | null): Promise<Ctx | null> {
  const db = getDb();
  const rows = await db
    .select({ user: schema.users, workspace: schema.workspaces, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(workspaceId ? and(eq(schema.memberships.userId, userId), eq(schema.memberships.workspaceId, workspaceId)) : eq(schema.memberships.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.user.id,
    userName: row.user.name,
    userEmail: row.user.email,
    workspaceId: row.workspace.id,
    workspaceName: row.workspace.name,
    role: row.role,
    isDemo: row.workspace.isDemo,
    correlationId: randomUUID(),
  };
}

async function demoCtx(): Promise<Ctx | null> {
  const db = getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, DEMO_EMAIL)).limit(1);
  return user ? loadCtx(user.id, null) : null;
}

/** Resolve the current session, or null. In demo mode an anonymous visitor becomes the seeded demo user. */
export async function getCtx(): Promise<Ctx | null> {
  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (session) {
    const ctx = await loadCtx(session.userId, session.workspaceId);
    if (ctx) return ctx;
  }
  return env.demoMode ? demoCtx() : null;
}

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) throw new AppError("unauthenticated", "Sign in to continue.");
  return ctx;
}

export async function login(email: string, password: string): Promise<{ token: string; expiresAt: number }> {
  const db = getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase())).limit(1);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new AppError("unauthenticated", "Email or password is incorrect.");
  }
  const ctx = await loadCtx(user.id, null);
  if (!ctx) throw new AppError("forbidden", "This account is not a member of any workspace.");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return { token: signSession(user.id, ctx.workspaceId, expiresAt), expiresAt };
}
