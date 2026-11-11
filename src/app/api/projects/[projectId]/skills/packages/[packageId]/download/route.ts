import { route } from "@/server/api";
import { exportPackageZip } from "@/server/services/skills";

export const GET = route<{ projectId: string; packageId: string }>(async ({ ctx, params }) => {
  const { fileName, bytes } = await exportPackageZip(ctx, params.projectId, params.packageId);
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${fileName}"` } });
});
