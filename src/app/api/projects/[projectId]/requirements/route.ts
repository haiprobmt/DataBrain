import { requirementsSaveSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { saveRequirements } from "@/server/services/projects";

export const PUT = route<{ projectId: string }>(async ({ ctx, params, body }) => {
  const rows = await saveRequirements(ctx, params.projectId, (await body(requirementsSaveSchema)).requirements);
  return { count: rows.length };
});
