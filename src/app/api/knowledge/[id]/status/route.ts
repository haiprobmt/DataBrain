import { statusChangeSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { setItemStatus } from "@/server/services/knowledge";

export const POST = route<{ id: string }>(async ({ ctx, params, body }) => {
  const item = await setItemStatus(ctx, params.id, (await body(statusChangeSchema)).status);
  return { id: item.id, status: item.status };
});
