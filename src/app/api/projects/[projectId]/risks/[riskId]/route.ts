import { riskUpdateSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { updateRisk } from "@/server/services/lifecycle";

export const PATCH = route<{ projectId: string; riskId: string }>(async ({ ctx, params, body }) => {
  const risk = await updateRisk(ctx, params.projectId, params.riskId, await body(riskUpdateSchema));
  return { id: risk.id, status: risk.status, score: risk.score, level: risk.level };
});
