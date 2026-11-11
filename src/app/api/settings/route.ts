import { settingsSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { updateSettings } from "@/server/services/workspace";

export const PUT = route(async ({ ctx, body }) => {
  await updateSettings(ctx, await body(settingsSchema));
  return { ok: true };
});
