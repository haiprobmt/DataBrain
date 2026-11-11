import { approvalApproveSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { decideStageApproval } from "@/server/services/lifecycle";

export const POST = route<{ projectId: string; stageId: string; approvalId: string }>(async ({ ctx, params, body }) => {
  const { note } = await body(approvalApproveSchema);
  return decideStageApproval(ctx, params.projectId, params.stageId, params.approvalId, "approve", note);
});
