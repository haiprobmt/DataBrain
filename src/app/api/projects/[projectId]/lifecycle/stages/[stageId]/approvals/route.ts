import { approvalRequestSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { requestStageApproval } from "@/server/services/lifecycle";

export const POST = route<{ projectId: string; stageId: string }>(async ({ ctx, params, body }) => {
  const approval = await requestStageApproval(ctx, params.projectId, params.stageId, await body(approvalRequestSchema));
  return { id: approval.id, status: "requested" };
});
