import { z } from "zod";
import { projectInputSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { setProjectStatus, updateProject } from "@/server/services/projects";

export const PUT = route<{ projectId: string }>(async ({ ctx, params, body }) => {
  const project = await updateProject(ctx, params.projectId, await body(projectInputSchema));
  return { id: project.id };
});

export const PATCH = route<{ projectId: string }>(async ({ ctx, params, body }) => {
  const { status } = await body(z.object({ status: z.enum(["active", "archived"]) }));
  const project = await setProjectStatus(ctx, params.projectId, status);
  return { id: project.id, status: project.status };
});
