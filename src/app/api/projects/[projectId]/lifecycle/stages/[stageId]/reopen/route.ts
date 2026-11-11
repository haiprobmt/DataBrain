import { stageReopenSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { reopenStage, stageResult } from "@/server/services/lifecycle";

export const POST = route<{ projectId: string; stageId: string }>(async ({ ctx, params, body }) => {
  const { reason } = await body(stageReopenSchema);
  return stageResult(await reopenStage(ctx, params.projectId, params.stageId, reason), params.stageId);
});
