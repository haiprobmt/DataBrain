import { and, desc, eq, inArray } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { ARTIFACT_DEFS, artifactDef, TEMPLATE_VERSION } from "@/lib/artifact-catalog";
import { validateContent } from "@/lib/content-checks";
import type { GenerationManifestBody, ManifestFile } from "@/lib/types";
import { audit } from "../audit";
import { assertCanEdit, type Ctx } from "../ctx";
import { hashJson, sha256 } from "../crypto";
import { getDb, schema } from "../db";
import { AppError, conflict, notFound, precondition } from "../errors";
import { background, createJob, runJob } from "../jobs";
import { renderArtifact, type TemplateData } from "./artifact-templates";
import { getRevision, listDecisions, type Revision } from "./blueprint";
import { getItemsByIds, getItemSources } from "./knowledge";
import { getProject, getRequirements } from "./projects";

const a = schema.artifacts;
const ar = schema.artifactRevisions;
const GENERATOR = "databrain-templates";
export type ArtifactRevision = typeof ar.$inferSelect;

export async function listArtifacts(ctx: Ctx, projectId: string) {
  const project = await getProject(ctx, projectId);
  const db = getDb();
  const artifacts = await db.select().from(a).where(eq(a.projectId, project.id));
  const revisions = artifacts.length
    ? await db
        .select({ id: ar.id, artifactId: ar.artifactId, version: ar.version, origin: ar.origin, checksum: ar.checksum, validation: ar.validation, architectureRevisionId: ar.architectureRevisionId, createdAt: ar.createdAt, templateVersion: ar.templateVersion })
        .from(ar)
        .where(inArray(ar.artifactId, artifacts.map((x) => x.id)))
        .orderBy(desc(ar.version))
    : [];
  return artifacts
    .map((artifact) => {
      const versions = revisions.filter((r) => r.artifactId === artifact.id);
      return { artifact, latest: versions[0] ?? null, versions };
    })
    .sort((x, y) => ARTIFACT_DEFS.findIndex((d) => d.type === x.artifact.type) - ARTIFACT_DEFS.findIndex((d) => d.type === y.artifact.type));
}

export async function getArtifact(ctx: Ctx, projectId: string, artifactId: string, version?: number) {
  const project = await getProject(ctx, projectId);
  const db = getDb();
  const [artifact] = await db.select().from(a).where(and(eq(a.id, artifactId), eq(a.projectId, project.id))).limit(1);
  if (!artifact) throw notFound("Artifact");
  const versions = await db.select().from(ar).where(eq(ar.artifactId, artifact.id)).orderBy(desc(ar.version));
  const revision = version ? versions.find((v) => v.version === version) : versions[0];
  if (!revision) throw notFound("Artifact version");
  return { artifact, revision, versions: versions.map((v) => ({ id: v.id, version: v.version, origin: v.origin, createdAt: v.createdAt, checksum: v.checksum, architectureRevisionId: v.architectureRevisionId })) };
}

async function templateData(ctx: Ctx, projectId: string, revision: Revision, generatedAt: string): Promise<TemplateData> {
  const [project, requirements, decisions, knowledge] = await Promise.all([getProject(ctx, projectId), getRequirements(ctx, projectId), listDecisions(ctx, projectId), getItemsByIds(ctx, revision.sourceItemIds)]);
  const sourceRows = await getItemSources(ctx, revision.sourceItemIds);
  const sources = [...new Map(sourceRows.map((s) => [s.source.id, { id: s.source.id, title: s.source.title, url: s.source.url, sourceType: s.source.sourceType }])).values()];
  return { project, requirements, revision, decisions, knowledge: knowledge.map((k) => ({ id: k.id, title: k.title, type: k.type, status: k.status, slug: k.slug })), sources, generatedAt, generator: `${GENERATOR}@${TEMPLATE_VERSION}` };
}

export interface GenerateInput {
  revisionId: string;
  types: string[];
  onEdited?: "keep" | "replace";
  idempotencyKey: string;
}

/**
 * Queue artifact generation from an approved architecture revision.
 * Hand-edited artifacts are never overwritten unless the caller chooses `onEdited: "replace"`.
 */
export async function generateArtifacts(ctx: Ctx, projectId: string, input: GenerateInput, options: { wait?: boolean } = {}) {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const revision = await getRevision(ctx, projectId, input.revisionId);
  if (revision.status !== "approved") throw precondition(`Artifacts are generated from an approved revision. Revision v${revision.version} is ${revision.status}.`);
  const unknown = input.types.filter((t) => !artifactDef(t));
  if (unknown.length) throw new AppError("validation_error", "Unknown artifact type.", { types: unknown.map((t) => `Unknown artifact type: ${t}`) });

  const current = await listArtifacts(ctx, projectId);
  const edited = current.filter((c) => input.types.includes(c.artifact.type) && c.latest?.origin === "user-edit");
  if (edited.length && !input.onEdited) {
    throw conflict("Some selected artifacts were edited by hand. Choose whether to keep your edits or replace them.", { edited: edited.map((e) => ({ type: e.artifact.type, name: e.artifact.name, version: e.latest!.version })) });
  }

  const { job, created } = await createJob(ctx, { projectId: project.id, kind: "artifacts", idempotencyKey: input.idempotencyKey, input: { revisionId: revision.id, types: input.types, onEdited: input.onEdited ?? null }, total: input.types.length });
  if (!created) return job;
  const work = () => runJob(job.id, (progress) => generate(ctx, project.id, revision, input, job.id, progress), input.types.length);
  if (options.wait) await work();
  else background(work);
  return job;
}

async function generate(ctx: Ctx, projectId: string, revision: Revision, input: GenerateInput, jobId: string, progress: (done: number, step: string) => Promise<void>) {
  const db = getDb();
  const generatedAt = new Date().toISOString();
  const data = await templateData(ctx, projectId, revision, generatedAt);
  const files: ManifestFile[] = [];
  const kept: string[] = [];
  let done = 0;

  for (const type of input.types) {
    const def = artifactDef(type)!;
    await progress(done, def.name);
    const content = renderArtifact(type, data);
    const validation = validateContent(def.format, content);

    const file = await db.transaction(async (tx) => {
      const [artifact] = await tx
        .insert(a)
        .values({ projectId, type, category: def.category, name: def.name, path: def.path, format: def.format })
        .onConflictDoUpdate({ target: [a.projectId, a.type], set: { name: def.name, path: def.path, category: def.category, format: def.format, updatedAt: new Date() } })
        .returning();
      const [latest] = await tx.select().from(ar).where(eq(ar.artifactId, artifact!.id)).orderBy(desc(ar.version)).limit(1);
      const toFile = (r: ArtifactRevision): ManifestFile => ({ path: def.path, type, category: def.category, format: def.format, artifactId: artifact!.id, artifactRevisionId: r.id, version: r.version, origin: r.origin, templateVersion: r.templateVersion, checksum: r.checksum, validationStatus: r.validation.status, sourceItemIds: r.sourceItemIds });
      if (latest?.origin === "user-edit" && input.onEdited === "keep") {
        kept.push(type);
        return toFile(latest);
      }
      const [created] = await tx
        .insert(ar)
        .values({
          artifactId: artifact!.id,
          version: (latest?.version ?? 0) + 1,
          architectureRevisionId: revision.id,
          jobId,
          origin: "generated",
          content,
          checksum: sha256(content),
          templateVersion: TEMPLATE_VERSION,
          generator: GENERATOR,
          sourceItemIds: revision.sourceItemIds,
          assumptions: data.requirements.filter((r) => r.kind === "assumption").map((r) => `${r.field}: ${r.value}`),
          validation,
          createdBy: ctx.userId,
        })
        .returning();
      return toFile(created!);
    });
    files.push(file);
    done += 1;
  }

  const body: GenerationManifestBody = {
    schemaVersion: 1,
    projectId,
    projectName: data.project.name,
    architectureRevisionId: revision.id,
    architectureRevisionVersion: revision.version,
    architectureContentHash: revision.contentHash ?? "",
    generatedAt,
    generator: `${GENERATOR}@${TEMPLATE_VERSION}`,
    files,
    sources: data.sources.map((s) => ({ ...s, status: "cited" })),
    assumptions: data.requirements.filter((r) => r.kind === "assumption" || r.state === "unknown").map((r) => (r.state === "unknown" ? `${r.field} is unknown` : `${r.field} is assumed: ${r.value}`)),
  };
  const [manifest] = await db.insert(schema.generationManifests).values({ projectId, jobId, architectureRevisionId: revision.id, body, hash: hashJson(body), createdBy: ctx.userId }).returning();
  await audit(ctx, { action: "artifacts.generate", entityType: "generation_manifest", entityId: manifest!.id, projectId, summary: `Generated ${files.length - kept.length} artifact(s) from blueprint v${revision.version}${kept.length ? `; kept ${kept.length} hand-edited` : ""}`, metadata: { manifestHash: manifest!.hash, kept } });
  return { manifestId: manifest!.id, manifestHash: manifest!.hash, generated: files.length - kept.length, kept, failedValidation: files.filter((f) => f.validationStatus === "failed").map((f) => f.path) };
}

export async function editArtifact(ctx: Ctx, projectId: string, artifactId: string, input: { content: string; expectedVersion: number }) {
  assertCanEdit(ctx);
  const { artifact, revision } = await getArtifact(ctx, projectId, artifactId);
  if (revision.version !== input.expectedVersion) throw conflict("A newer version of this artifact exists. Reload it before saving your edit.", { currentVersion: revision.version });
  if (revision.content === input.content) return revision;
  const [created] = await getDb()
    .insert(ar)
    .values({
      artifactId: artifact.id,
      version: revision.version + 1,
      architectureRevisionId: revision.architectureRevisionId,
      origin: "user-edit",
      reviewStatus: "reviewed",
      content: input.content,
      checksum: sha256(input.content),
      templateVersion: revision.templateVersion,
      generator: revision.generator,
      sourceItemIds: revision.sourceItemIds,
      assumptions: revision.assumptions,
      validation: validateContent(artifact.format, input.content),
      createdBy: ctx.userId,
    })
    .returning();
  await audit(ctx, { action: "artifact.edit", entityType: "artifact", entityId: artifact.id, projectId, summary: `Edited ${artifact.name} (v${created!.version})` });
  return created!;
}

// ── Manifests & export ──────────────────────────────────────────────────────
export async function listManifests(ctx: Ctx, projectId: string) {
  const project = await getProject(ctx, projectId);
  return getDb().select().from(schema.generationManifests).where(eq(schema.generationManifests.projectId, project.id)).orderBy(desc(schema.generationManifests.createdAt));
}

export async function getManifest(ctx: Ctx, projectId: string, manifestId: string) {
  const project = await getProject(ctx, projectId);
  const [manifest] = await getDb().select().from(schema.generationManifests).where(and(eq(schema.generationManifests.id, manifestId), eq(schema.generationManifests.projectId, project.id))).limit(1);
  if (!manifest) throw notFound("Generation manifest");
  return manifest;
}

/** The exact file contents a manifest refers to, by artifact revision ID. */
export async function manifestFiles(ctx: Ctx, projectId: string, manifestId: string) {
  const manifest = await getManifest(ctx, projectId, manifestId);
  const ids = manifest.body.files.map((f) => f.artifactRevisionId);
  const rows = ids.length ? await getDb().select({ id: ar.id, content: ar.content, checksum: ar.checksum }).from(ar).where(inArray(ar.id, ids)) : [];
  const files = manifest.body.files.map((f) => {
    const row = rows.find((r) => r.id === f.artifactRevisionId);
    return { ...f, content: row?.content ?? "", actualChecksum: row ? sha256(row.content) : null };
  });
  return { manifest, files };
}

export async function exportManifestZip(ctx: Ctx, projectId: string, manifestId: string): Promise<{ fileName: string; bytes: Uint8Array }> {
  const { manifest, files } = await manifestFiles(ctx, projectId, manifestId);
  const body = manifest.body;
  const readme = `# ${body.projectName} — solution package

Generated by DataBrain from architecture revision v${body.architectureRevisionVersion} (\`${body.architectureRevisionId}\`).

**Status: generated, not validated.** Every file is a starting point for review. Values marked TODO or PLACEHOLDER
must be supplied by you; DataBrain does not invent tenant IDs, network ranges, SKUs or prices. The package contains no secrets.

## Contents

${files.map((f) => `- \`${f.path}\` — ${f.type}, v${f.version}, ${f.origin}, validation: ${f.validationStatus}`).join("\n")}

## Suggested order

1. Read \`docs/executive-summary.md\` and \`docs/hld.md\`.
2. Complete the placeholders in \`docs/lld.md\` and \`iac/main.tf\`.
3. Use \`qa/test-plan.md\` and the migration files to plan delivery.

\`manifest.json\` lists every file with its checksum (SHA-256) and the knowledge it was derived from.
Manifest hash: \`${manifest.hash}\`
`;
  const entries: Record<string, Uint8Array> = { "README.md": strToU8(readme), "manifest.json": strToU8(JSON.stringify({ ...body, manifestHash: manifest.hash }, null, 2) + "\n") };
  for (const file of files) entries[file.path] = strToU8(file.content);
  await audit(ctx, { action: "artifacts.export", entityType: "generation_manifest", entityId: manifest.id, projectId, summary: `Exported solution package (${files.length} files)`, metadata: { manifestHash: manifest.hash } });
  return { fileName: `databrain-package-v${body.architectureRevisionVersion}-${manifest.hash.slice(0, 8)}.zip`, bytes: zipSync(entries, { level: 6, mtime: new Date(body.generatedAt) }) };
}
