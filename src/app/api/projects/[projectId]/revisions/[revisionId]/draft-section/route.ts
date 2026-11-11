import { z } from "zod";
import { route } from "@/server/api";
import { draftSection } from "@/server/services/blueprint";

export const maxDuration = 300;

export const POST = route<{ projectId: string; revisionId: string }>(async ({ ctx, params, body }) => {
  const { key } = await body(z.object({ key: z.string().trim().min(1).max(60) }));
  return draftSection(ctx, params.projectId, params.revisionId, key);
});
