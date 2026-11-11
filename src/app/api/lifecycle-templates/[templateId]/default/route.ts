import { route } from "@/server/api";
import { setDefaultLifecycleTemplate } from "@/server/services/lifecycle-templates";

export const POST = route<{ templateId: string }>(async ({ ctx, params }) => {
  const template = await setDefaultLifecycleTemplate(ctx, params.templateId);
  return { id: template.id, isDefault: template.isDefault };
});
