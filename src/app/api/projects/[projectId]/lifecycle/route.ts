import { lifecycleInitSchema, lifecycleUpdateSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { getProjectLifecycle, initializeProjectLifecycle, updateLifecycle } from "@/server/services/lifecycle";

type Params = { projectId: string };

export const GET = route<Params>(async ({ ctx, params }) => getProjectLifecycle(ctx, params.projectId));

/** Start the lifecycle. A project has one lifecycle: a second call is a 409, never a duplicate. */
export const POST = route<Params>(async ({ ctx, params, body }) => {
  const { templateId } = await body(lifecycleInitSchema);
  const view = await initializeProjectLifecycle(ctx, params.projectId, templateId);
  return { id: view.lifecycle!.id, status: view.lifecycle!.status, stages: view.stages.length };
});

export const PATCH = route<Params>(async ({ ctx, params, body }) => {
  const view = await updateLifecycle(ctx, params.projectId, await body(lifecycleUpdateSchema));
  return { id: view.lifecycle!.id, status: view.lifecycle!.status, targetEndAt: view.lifecycle!.targetEndAt };
});
