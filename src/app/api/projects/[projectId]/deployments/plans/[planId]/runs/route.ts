import { runCreateSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { startRun } from "@/server/services/deployments";

export const POST = route<{ projectId: string; planId: string }>(async ({ ctx, params, body }) => {
  const run = await startRun(ctx, params.projectId, params.planId, await body(runCreateSchema));
  return { id: run.id, status: run.status, mode: run.mode };
});
