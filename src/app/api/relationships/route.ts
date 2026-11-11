import { relationshipInputSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { addRelationship } from "@/server/services/knowledge";

export const POST = route(async ({ ctx, body }) => {
  const rel = await addRelationship(ctx, await body(relationshipInputSchema));
  return { id: rel.id };
});
