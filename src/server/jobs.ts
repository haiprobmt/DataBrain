import { and, eq, lt } from "drizzle-orm";
import type { Ctx } from "./ctx";
import { getDb, schema } from "./db";
import { notFound } from "./errors";

const j = schema.generationJobs;
export type Job = typeof j.$inferSelect;
const STALE_AFTER_MS = 5 * 60_000;

/**
 * Create a job, or return the existing one for the same idempotency key.
 * `created` is false when the key was seen before, so the caller must not start the work twice.
 */
export async function createJob(ctx: Ctx, input: { projectId: string; kind: Job["kind"]; idempotencyKey: string; input: Record<string, unknown>; total: number }): Promise<{ job: Job; created: boolean }> {
  const db = getDb();
  const [job] = await db
    .insert(j)
    .values({ workspaceId: ctx.workspaceId, projectId: input.projectId, kind: input.kind, idempotencyKey: input.idempotencyKey, input: input.input, progress: { done: 0, total: input.total }, createdBy: ctx.userId })
    .onConflictDoNothing()
    .returning();
  if (job) return { job, created: true };
  const [existing] = await db.select().from(j).where(and(eq(j.projectId, input.projectId), eq(j.idempotencyKey, input.idempotencyKey))).limit(1);
  return { job: existing!, created: false };
}

export async function getJob(ctx: Ctx, jobId: string): Promise<Job> {
  const db = getDb();
  // A job left "running" by a restarted server is reported as failed rather than spinning forever.
  await db
    .update(j)
    .set({ status: "failed", error: "The server restarted while this job was running. Start it again.", finishedAt: new Date() })
    .where(and(eq(j.id, jobId), eq(j.status, "running"), lt(j.updatedAt, new Date(Date.now() - STALE_AFTER_MS))));
  const [job] = await db.select().from(j).where(and(eq(j.id, jobId), eq(j.workspaceId, ctx.workspaceId))).limit(1);
  if (!job) throw notFound("Job");
  return job;
}

export async function updateJob(jobId: string, patch: Partial<Pick<Job, "status" | "progress" | "result" | "error" | "startedAt" | "finishedAt">>): Promise<void> {
  await getDb().update(j).set(patch).where(eq(j.id, jobId));
}

/** Run a job body, recording running → succeeded/failed with the real outcome. */
export async function runJob(jobId: string, body: (progress: (done: number, step: string) => Promise<void>) => Promise<Record<string, unknown>>, total: number): Promise<void> {
  await updateJob(jobId, { status: "running", startedAt: new Date() });
  try {
    const result = await body((done, step) => updateJob(jobId, { progress: { done, total, step } }));
    await updateJob(jobId, { status: "succeeded", result, finishedAt: new Date(), progress: { done: total, total } });
  } catch (error) {
    console.error(`[job ${jobId}]`, error);
    await updateJob(jobId, { status: "failed", error: error instanceof Error ? error.message : String(error), finishedAt: new Date() });
  }
}

/** Start work without blocking the request. Tests pass `wait` to the services instead. */
export function background(work: () => Promise<void>): void {
  void Promise.resolve()
    .then(work)
    .catch((error) => console.error("[background]", error));
}
