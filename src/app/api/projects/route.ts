import { projectInputSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { createProject, listProjects } from "@/server/services/projects";

export const GET = route(async ({ ctx, query }) => {
  const rows = await listProjects(ctx, { includeArchived: query.get("archived") === "1" });
  return { items: rows.map((r) => ({ id: r.project.id, name: r.project.name, status: r.project.status, requirementsStatus: r.project.requirementsStatus })) };
});

export const POST = route(async ({ ctx, body }) => {
  const project = await createProject(ctx, await body(projectInputSchema));
  return { id: project.id };
});
