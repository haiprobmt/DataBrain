import { planCreateSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { createPlan } from "@/server/services/deployments";

export const POST = route<{ projectId: string }>(async ({ ctx, params, body }) => {
  const plan = await createPlan(ctx, params.projectId, await body(planCreateSchema));
  return { id: plan.id, planHash: plan.planHash };
});
