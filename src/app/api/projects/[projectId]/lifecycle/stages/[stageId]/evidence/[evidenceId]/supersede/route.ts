import { evidenceSupersedeSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { supersedeStageEvidence } from "@/server/services/lifecycle";

/** Evidence is append-only: a wrong reference is marked superseded, not edited or deleted. */
export const POST = route<{ projectId: string; stageId: string; evidenceId: string }>(async ({ ctx, params, body }) => {
  const { reason } = await body(evidenceSupersedeSchema);
  return supersedeStageEvidence(ctx, params.projectId, params.stageId, params.evidenceId, reason);
});
