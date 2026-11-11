import { riskCreateSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { createRisk, listRisks } from "@/server/services/lifecycle";

type Params = { projectId: string };

export const GET = route<Params>(async ({ ctx, params }) => ({ items: await listRisks(ctx, params.projectId) }));

/** The score is computed on the server from likelihood and impact; a `severity` in the body is rejected. */
export const POST = route<Params>(async ({ ctx, params, body }) => {
  const risk = await createRisk(ctx, params.projectId, await body(riskCreateSchema));
  return { id: risk.id, score: risk.score, level: risk.level };
});
