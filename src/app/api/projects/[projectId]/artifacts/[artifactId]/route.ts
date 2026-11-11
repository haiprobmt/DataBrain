import { artifactEditSchema } from "@/lib/schemas";
import { route } from "@/server/api";
import { editArtifact, getArtifact } from "@/server/services/artifacts";

export const GET = route<{ projectId: string; artifactId: string }>(async ({ ctx, params, query }) => {
  const version = query.get("version");
  const { artifact, revision, versions } = await getArtifact(ctx, params.projectId, params.artifactId, version ? Number(version) : undefined);
  return {
    artifact: { id: artifact.id, name: artifact.name, path: artifact.path, format: artifact.format, type: artifact.type },
    revision: { id: revision.id, version: revision.version, origin: revision.origin, content: revision.content, checksum: revision.checksum, validation: revision.validation, createdAt: revision.createdAt, architectureRevisionId: revision.architectureRevisionId, templateVersion: revision.templateVersion },
    versions,
  };
});

export const PUT = route<{ projectId: string; artifactId: string }>(async ({ ctx, params, body }) => {
  const revision = await editArtifact(ctx, params.projectId, params.artifactId, await body(artifactEditSchema));
  return { version: revision.version, validation: revision.validation };
});
