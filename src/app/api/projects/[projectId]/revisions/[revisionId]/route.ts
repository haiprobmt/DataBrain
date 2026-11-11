import { revisionUpdateSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { updateRevision } from "@/server/services/blueprint";

export const PUT = route<{ projectId: string; revisionId: string }>(async ({ ctx, params, body }) => {
  const revision = await updateRevision(ctx, params.projectId, params.revisionId, await body(revisionUpdateSchema));
  return { id: revision.id, lockVersion: revision.lockVersion };
});
