import { approvalCreateSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { approvePlan } from "@/server/services/deployments";

export const POST = route<{ projectId: string; planId: string }>(async ({ ctx, params, body }) => {
  const approval = await approvePlan(ctx, params.projectId, params.planId, await body(approvalCreateSchema));
  return { id: approval.id, expiresAt: approval.expiresAt };
});
