import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { requireCtx } from "@/server/auth";
import { getApprovedRevision } from "@/server/services/blueprint";
import { listPackages, listSkills } from "@/server/services/skills";
import { SkillFactory } from "./skill-factory";

export const metadata = { title: "AI Skill Factory" };

export default async function SkillsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const [approved, skills, packages] = await Promise.all([getApprovedRevision(ctx, projectId), listSkills(ctx, projectId), listPackages(ctx, projectId)]);
  if (!approved && skills.length === 0) {
    return (
      <Card>
        <EmptyState title="Approve a blueprint first" action={<Link className="btn primary" href={`/projects/${projectId}/blueprint`}>Open the Solution Blueprint</Link>}>
          Skills are composed from an approved architecture revision and the knowledge it is based on.
        </EmptyState>
      </Card>
    );
  }
  return (
    <SkillFactory
      projectId={projectId}
      readOnly={ctx.role === "viewer"}
      approved={approved ? { id: approved.id, version: approved.version } : null}
      skills={skills.filter((s) => s.latest).map((s) => ({ id: s.skill.id, name: s.skill.name, kind: s.skill.kind, title: s.skill.title, dependsOn: s.dependsOn, version: s.latest!.version, origin: s.latest!.origin, skillMd: s.latest!.skillMd, files: s.latest!.files, compatibility: s.latest!.compatibility, validation: s.latest!.validation, architectureRevisionId: s.latest!.architectureRevisionId, versions: s.versions.map((v) => ({ version: v.version, origin: v.origin, createdAt: v.createdAt.toISOString() })) }))}
      packages={packages.map((p) => ({ id: p.id, version: p.version, name: p.name, createdAt: p.createdAt.toISOString(), checksum: p.checksum, manifest: p.manifest as { executionOrder: string[]; conflicts: { skills: string[]; reason: string }[]; skills: { name: string; version: number }[] } }))}
    />
  );
}
