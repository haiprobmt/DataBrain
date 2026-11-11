import { z } from "zod";
import { sourceInputSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { attachSource, createSource, detachSource } from "@/server/services/knowledge";

const attachSchema = z.union([z.object({ sourceId: z.string().uuid(), note: z.string().max(300).optional() }), sourceInputSchema]);

export const POST = route<{ id: string }>(async ({ ctx, params, body }) => {
  const input = await body(attachSchema);
  if ("sourceId" in input) {
    await attachSource(ctx, params.id, input.sourceId, input.note);
    return { ok: true };
  }
  const source = await createSource(ctx, { ...input, itemId: params.id });
  return { id: source.id };
});

export const DELETE = route<{ id: string }>(async ({ ctx, params, query }) => {
  await detachSource(ctx, params.id, query.get("sourceId") ?? "");
  return { ok: true };
});
