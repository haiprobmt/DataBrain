import { sourceInputSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { createSource } from "@/server/services/knowledge";

export const POST = route(async ({ ctx, body }) => {
  const source = await createSource(ctx, await body(sourceInputSchema));
  return { id: source.id };
});
