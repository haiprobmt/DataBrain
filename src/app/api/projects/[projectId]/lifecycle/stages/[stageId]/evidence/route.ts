import { evidenceCreateSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { addStageEvidence, listStageEvidence } from "@/server/services/lifecycle";

type Params = { projectId: string; stageId: string };

export const GET = route<Params>(async ({ ctx, params }) => ({ items: await listStageEvidence(ctx, params.projectId, params.stageId) }));

export const POST = route<Params>(async ({ ctx, params, body }) => addStageEvidence(ctx, params.projectId, params.stageId, await body(evidenceCreateSchema)));
