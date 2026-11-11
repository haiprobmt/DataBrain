import { environmentInputSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { createEnvironment } from "@/server/services/projects";

export const POST = route<{ projectId: string }>(async ({ ctx, params, body }) => {
  const environment = await createEnvironment(ctx, params.projectId, await body(environmentInputSchema));
  return { id: environment.id };
});
