import { revisionCreateSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { cloneRevision, createRevisionFromCandidate } from "@/server/services/blueprint";

export const POST = route<{ projectId: string }>(async ({ ctx, params, body }) => {
  const input = await body(revisionCreateSchema);
  const revision = "candidateId" in input ? await createRevisionFromCandidate(ctx, params.projectId, input.candidateId) : await cloneRevision(ctx, params.projectId, input.fromRevisionId);
  return { id: revision.id, version: revision.version };
});
