import { stageSkipSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { skipStage, stageResult } from "@/server/services/lifecycle";

export const POST = route<{ projectId: string; stageId: string }>(async ({ ctx, params, body }) => {
  const { reason } = await body(stageSkipSchema);
  return stageResult(await skipStage(ctx, params.projectId, params.stageId, reason), params.stageId);
});
