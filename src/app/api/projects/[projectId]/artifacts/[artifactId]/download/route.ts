import { route } from "@/server/api";
import { markdownToDocx } from "@/server/docx";
import { AppError } from "@/server/errors";
import { getArtifact } from "@/server/services/artifacts";

export const GET = route<{ projectId: string; artifactId: string }>(async ({ ctx, params, query }) => {
  const version = query.get("version");
  const { artifact, revision } = await getArtifact(ctx, params.projectId, params.artifactId, version ? Number(version) : undefined);
  const baseName = artifact.path.split("/").pop() ?? "artifact.txt";
  if (query.get("format") === "docx") {
    if (artifact.format !== "markdown") throw new AppError("validation_error", "Only Markdown documents can be exported as DOCX.");
    const bytes = await markdownToDocx(revision.content);
    return new Response(new Uint8Array(bytes), {
      headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "content-disposition": `attachment; filename="${baseName.replace(/\.md$/, "")}-v${revision.version}.docx"` },
    });
  }
  return new Response(revision.content, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${baseName}"` } });
});
