import { route } from "@/server/api";
import { createPackage } from "@/server/services/skills";

export const POST = route<{ projectId: string }>(async ({ ctx, params }) => {
  const pkg = await createPackage(ctx, params.projectId);
  return { id: pkg.id, version: pkg.version };
});
