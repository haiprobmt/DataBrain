import { route } from "@/server/api";
import { getGraph } from "@/server/services/knowledge";

export const GET = route(async ({ ctx, query }) =>
  getGraph(ctx, {
    focusId: query.get("focus") ?? undefined,
    depth: Number(query.get("depth") ?? "1"),
    types: query.get("types")?.split(",").filter(Boolean),
    status: query.get("status") ?? undefined,
    q: query.get("q") ?? undefined,
  }),
);
