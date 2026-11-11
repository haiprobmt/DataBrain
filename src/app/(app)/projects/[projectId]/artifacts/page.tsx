import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { requireCtx } from "@/server/auth";
import { listArtifacts, listManifests } from "@/server/services/artifacts";
import { getApprovedRevision } from "@/server/services/blueprint";
import { ArtifactFactory } from "./artifact-factory";

export const metadata = { title: "Artifact Factory" };

export default async function ArtifactsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const [approved, artifacts, manifests] = await Promise.all([getApprovedRevision(ctx, projectId), listArtifacts(ctx, projectId), listManifests(ctx, projectId)]);
  if (!approved && artifacts.length === 0) {
    return (
      <Card>
        <EmptyState title="Approve a blueprint first" action={<Link className="btn primary" href={`/projects/${projectId}/blueprint`}>Open the Solution Blueprint</Link>}>
          Artifacts are generated from an approved architecture revision, so every file traces to an exact, immutable version.
        </EmptyState>
      </Card>
    );
  }
  return (
    <ArtifactFactory
      projectId={projectId}
      readOnly={ctx.role === "viewer"}
      approved={approved ? { id: approved.id, version: approved.version, title: approved.title } : null}
      artifacts={artifacts.map((a) => ({ id: a.artifact.id, type: a.artifact.type, latest: a.latest ? { version: a.latest.version, origin: a.latest.origin, status: a.latest.validation.status, architectureRevisionId: a.latest.architectureRevisionId } : null }))}
      manifests={manifests.map((m) => ({ id: m.id, hash: m.hash, createdAt: m.createdAt.toISOString(), revisionVersion: m.body.architectureRevisionVersion, files: m.body.files.map((f) => ({ path: f.path, version: f.version, origin: f.origin, validationStatus: f.validationStatus, checksum: f.checksum })) }))}
    />
  );
}
