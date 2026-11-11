import { stageUpdateSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { stageResult, updateStage } from "@/server/services/lifecycle";

/** Owner, reviewer, due date and notes; an optional `status` goes through the server's transition rules. */
export const PATCH = route<{ projectId: string; stageId: string }>(async ({ ctx, params, body }) => {
  return stageResult(await updateStage(ctx, params.projectId, params.stageId, await body(stageUpdateSchema)), params.stageId);
});
