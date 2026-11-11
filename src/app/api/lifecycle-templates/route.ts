import { templateCreateSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { createLifecycleTemplate, listLifecycleTemplates } from "@/server/services/lifecycle-templates";

export const GET = route(async ({ ctx }) => ({ items: await listLifecycleTemplates(ctx) }));

export const POST = route(async ({ ctx, body }) => {
  const template = await createLifecycleTemplate(ctx, await body(templateCreateSchema));
  return { id: template.id, version: template.version };
});
