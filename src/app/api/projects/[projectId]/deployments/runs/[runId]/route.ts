import { route } from "@/server/api";
import { getRun } from "@/server/services/deployments";

export const GET = route<{ projectId: string; runId: string }>(async ({ ctx, params }) => {
  const { run, checks, evidence } = await getRun(ctx, params.projectId, params.runId);
  return { run, checks, evidence };
});
