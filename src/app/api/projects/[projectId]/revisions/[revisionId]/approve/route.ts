import { approveSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { approveRevision } from "@/server/services/blueprint";

export const POST = route<{ projectId: string; revisionId: string }>(async ({ ctx, params, body }) => {
  const revision = await approveRevision(ctx, params.projectId, params.revisionId, await body(approveSchema));
  return { id: revision.id, status: revision.status, contentHash: revision.contentHash };
});
