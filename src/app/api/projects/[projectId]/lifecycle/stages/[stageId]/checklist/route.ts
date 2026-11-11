import { checklistCreateSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { createChecklistItem, listChecklistItems } from "@/server/services/lifecycle";

type Params = { projectId: string; stageId: string };

export const GET = route<Params>(async ({ ctx, params }) => ({ items: await listChecklistItems(ctx, params.projectId, params.stageId) }));

export const POST = route<Params>(async ({ ctx, params, body }) => createChecklistItem(ctx, params.projectId, params.stageId, await body(checklistCreateSchema)));
