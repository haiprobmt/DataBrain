import { milestoneCreateSchema } from "@/lib/lifecycle-schemas";
import { route } from "@/server/api";
import { createMilestone, listMilestones } from "@/server/services/lifecycle";

type Params = { projectId: string };

export const GET = route<Params>(async ({ ctx, params }) => ({ items: await listMilestones(ctx, params.projectId) }));

export const POST = route<Params>(async ({ ctx, params, body }) => createMilestone(ctx, params.projectId, await body(milestoneCreateSchema)));
