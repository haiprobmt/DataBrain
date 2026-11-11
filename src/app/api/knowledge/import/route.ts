import { importSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { importDocument } from "@/server/services/knowledge";

export const POST = route(async ({ ctx, body }) => {
  const result = await importDocument(ctx, await body(importSchema));
  return { id: result.item.id, slug: result.item.slug, chunks: result.chunks, duplicates: result.duplicates };
});
