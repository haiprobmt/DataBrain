import { milestoneUpdateSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { deleteMilestone, updateMilestone } from "@/server/services/lifecycle";

type Params = { projectId: string; milestoneId: string };

export const PATCH = route<Params>(async ({ ctx, params, body }) => updateMilestone(ctx, params.projectId, params.milestoneId, await body(milestoneUpdateSchema)));

export const DELETE = route<Params>(async ({ ctx, params }) => {
  await deleteMilestone(ctx, params.projectId, params.milestoneId);
  return { ok: true };
});
