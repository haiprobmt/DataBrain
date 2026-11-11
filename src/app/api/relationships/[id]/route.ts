import { route } from "@/server/api";
import { removeRelationship } from "@/server/services/knowledge";

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await removeRelationship(ctx, params.id);
  return { ok: true };
});
