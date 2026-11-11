import { askSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { ask } from "@/server/services/knowledge";

export const POST = route(async ({ ctx, body }) => ask(ctx, (await body(askSchema)).question));
