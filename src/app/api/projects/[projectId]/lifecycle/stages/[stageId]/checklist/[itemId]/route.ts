import { checklistUpdateSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { deleteChecklistItem, updateChecklistItem } from "@/server/services/lifecycle";

type Params = { projectId: string; stageId: string; itemId: string };

export const PATCH = route<Params>(async ({ ctx, params, body }) => updateChecklistItem(ctx, params.projectId, params.stageId, params.itemId, await body(checklistUpdateSchema)));

/** Only optional items added to this project can be deleted; anything else is waived with a reason. */
export const DELETE = route<Params>(async ({ ctx, params }) => {
  await deleteChecklistItem(ctx, params.projectId, params.stageId, params.itemId);
  return { ok: true };
});
