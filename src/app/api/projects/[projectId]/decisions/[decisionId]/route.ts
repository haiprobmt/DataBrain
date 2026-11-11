import { decisionInputSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { updateDecision } from "@/server/services/blueprint";

export const PUT = route<{ projectId: string; decisionId: string }>(async ({ ctx, params, body }) => {
  const decision = await updateDecision(ctx, params.projectId, params.decisionId, await body(decisionInputSchema));
  return { id: decision.id };
});
