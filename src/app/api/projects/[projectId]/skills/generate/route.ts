import { generateSkillsSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { generateSkills } from "@/server/services/skills";

export const POST = route<{ projectId: string }>(async ({ ctx, params, body }) => {
  const job = await generateSkills(ctx, params.projectId, await body(generateSkillsSchema));
  return { id: job.id, status: job.status, progress: job.progress, error: job.error, result: job.result };
});
