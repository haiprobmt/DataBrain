import { templateActiveSchema, templateUpdateSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { getLifecycleTemplate, setLifecycleTemplateActive, updateLifecycleTemplate } from "@/server/services/lifecycle-templates";

type Params = { templateId: string };

export const GET = route<Params>(async ({ ctx, params }) => getLifecycleTemplate(ctx, params.templateId));

export const PUT = route<Params>(async ({ ctx, params, body }) => {
  const template = await updateLifecycleTemplate(ctx, params.templateId, await body(templateUpdateSchema));
  return { id: template.id, version: template.version };
});

/** Deactivate or reactivate. */
export const PATCH = route<Params>(async ({ ctx, params, body }) => {
  const template = await setLifecycleTemplateActive(ctx, params.templateId, (await body(templateActiveSchema)).isActive);
  return { id: template.id, isActive: template.isActive };
});
