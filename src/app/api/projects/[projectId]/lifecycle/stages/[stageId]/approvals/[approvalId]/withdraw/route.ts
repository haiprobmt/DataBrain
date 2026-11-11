import { approvalWithdrawSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { decideStageApproval } from "@/server/services/lifecycle";

export const POST = route<{ projectId: string; stageId: string; approvalId: string }>(async ({ ctx, params, body }) => {
  const { note } = await body(approvalWithdrawSchema);
  return decideStageApproval(ctx, params.projectId, params.stageId, params.approvalId, "withdraw", note);
});
