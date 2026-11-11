import { route } from "@/server/api";
import { extractRequirements } from "@/server/services/projects";

export const POST = route<{ projectId: string }>(async ({ ctx, params }) => {
  const { extraction, keptUserFields } = await extractRequirements(ctx, params.projectId);
  return { provider: extraction.provider, model: extraction.model, facts: extraction.facts.length, missing: extraction.missing.length, assumptions: extraction.assumptions, keptUserFields };
});
