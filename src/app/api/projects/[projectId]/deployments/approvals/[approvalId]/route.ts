import { route } from "@/server/api";
import { revokeApproval } from "@/server/services/deployments";

export const DELETE = route<{ projectId: string; approvalId: string }>(async ({ ctx, params }) => {
  await revokeApproval(ctx, params.projectId, params.approvalId);
  return { ok: true };
});
