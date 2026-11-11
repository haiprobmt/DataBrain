import { generateArtifactsSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { generateArtifacts } from "@/server/services/artifacts";

export const POST = route<{ projectId: string }>(async ({ ctx, params, body }) => {
  const job = await generateArtifacts(ctx, params.projectId, await body(generateArtifactsSchema));
  return { id: job.id, status: job.status, progress: job.progress, error: job.error, result: job.result };
});
