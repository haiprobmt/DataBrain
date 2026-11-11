import { route } from "@/server/api";
import { stageResult, startStage } from "@/server/services/lifecycle";

/** Start a stage, or resume a blocked one. */
export const POST = route<{ projectId: string; stageId: string }>(async ({ ctx, params }) => {
  return stageResult(await startStage(ctx, params.projectId, params.stageId), params.stageId);
});
