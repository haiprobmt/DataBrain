import { knowledgeInputSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { createItem, listItems } from "@/server/services/knowledge";

export const GET = route(async ({ ctx, query }) => {
  const { items, total } = await listItems(ctx, {
    q: query.get("q") ?? undefined,
    types: query.get("types")?.split(",").filter(Boolean),
    status: query.get("status") ?? undefined,
    limit: Number(query.get("limit") ?? "50"),
    offset: Number(query.get("offset") ?? "0"),
    sort: query.get("sort") === "title" ? "title" : "updated",
  });
  return { total, items: items.map((i) => ({ id: i.id, slug: i.slug, title: i.title, type: i.type, status: i.status, summary: i.summary })) };
});

export const POST = route(async ({ ctx, body }) => {
  const item = await createItem(ctx, await body(knowledgeInputSchema));
  return { id: item.id, slug: item.slug };
});
