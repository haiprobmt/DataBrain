import { route } from "@/server/api";
import { exportManifestZip } from "@/server/services/artifacts";

export const GET = route<{ projectId: string; manifestId: string }>(async ({ ctx, params }) => {
  const { fileName, bytes } = await exportManifestZip(ctx, params.projectId, params.manifestId);
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${fileName}"` } });
});
