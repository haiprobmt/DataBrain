import { finderRunSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { runFinder } from "@/server/services/finder";

export const POST = route<{ projectId: string }>(async ({ ctx, params, body }) => {
  const { weights } = await body(finderRunSchema);
  const result = await runFinder(ctx, params.projectId, weights);
  return { run: result.run, candidates: result.candidates.length, excluded: result.excluded.length };
});
