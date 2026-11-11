import { checklistWaiveSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { waiveChecklistItem } from "@/server/services/lifecycle";

export const POST = route<{ projectId: string; stageId: string; itemId: string }>(async ({ ctx, params, body }) => {
  const { reason } = await body(checklistWaiveSchema);
  return waiveChecklistItem(ctx, params.projectId, params.stageId, params.itemId, reason);
});
