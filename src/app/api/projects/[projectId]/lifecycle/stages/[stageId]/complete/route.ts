import { stageCompleteSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { completeStage, stageResult } from "@/server/services/lifecycle";

export const POST = route<{ projectId: string; stageId: string }>(async ({ ctx, params, body }) => {
  const { completionNote } = await body(stageCompleteSchema);
  return stageResult(await completeStage(ctx, params.projectId, params.stageId, completionNote), params.stageId);
});
