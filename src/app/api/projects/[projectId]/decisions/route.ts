import { decisionInputSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { createDecision } from "@/server/services/blueprint";

export const POST = route<{ projectId: string }>(async ({ ctx, params, body }) => {
  const decision = await createDecision(ctx, params.projectId, await body(decisionInputSchema));
  return { id: decision.id, number: decision.number };
});
