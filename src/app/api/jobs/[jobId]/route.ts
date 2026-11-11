import { route } from "@/server/api";
import { getJob } from "@/server/jobs";

export const GET = route<{ jobId: string }>(async ({ ctx, params }) => {
  const job = await getJob(ctx, params.jobId);
  return { id: job.id, kind: job.kind, status: job.status, progress: job.progress, error: job.error, result: job.result };
});
