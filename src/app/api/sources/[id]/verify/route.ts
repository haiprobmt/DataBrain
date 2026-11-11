import { route } from "@/server/api";
import { markSourceVerified } from "@/server/services/knowledge";

export const POST = route<{ id: string }>(async ({ ctx, params }) => {
  await markSourceVerified(ctx, params.id);
  return { ok: true };
});
