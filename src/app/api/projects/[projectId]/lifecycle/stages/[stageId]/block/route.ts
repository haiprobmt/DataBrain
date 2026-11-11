import { stageBlockSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { blockStage, stageResult } from "@/server/services/lifecycle";

export const POST = route<{ projectId: string; stageId: string }>(async ({ ctx, params, body }) => {
  const { reason } = await body(stageBlockSchema);
  return stageResult(await blockStage(ctx, params.projectId, params.stageId, reason), params.stageId);
});
