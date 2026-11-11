import { skillEditSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { editSkill } from "@/server/services/skills";

export const PUT = route<{ projectId: string; skillId: string }>(async ({ ctx, params, body }) => {
  const version = await editSkill(ctx, params.projectId, params.skillId, await body(skillEditSchema));
  return { version: version.version, validation: version.validation };
});
