import { route } from "@/server/api";
import { approveRequirements } from "@/server/services/projects";

export const POST = route<{ projectId: string }>(async ({ ctx, params }) => {
  const project = await approveRequirements(ctx, params.projectId);
  return { requirementsStatus: project.requirementsStatus };
});
