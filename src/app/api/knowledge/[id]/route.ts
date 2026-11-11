import { knowledgeUpdateSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { updateItem } from "@/server/services/knowledge";

export const PUT = route<{ id: string }>(async ({ ctx, params, body }) => {
  const item = await updateItem(ctx, params.id, await body(knowledgeUpdateSchema));
  return { id: item.id, slug: item.slug, version: item.version, status: item.status };
});
