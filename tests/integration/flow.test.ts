import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { eq } from "drizzle-orm";
import { freshDatabase } from "./setup";
import type { Ctx } from "@/server/ctx";
import { AppError } from "@/server/errors";
import { closeDb, getDb, schema } from "@/server/db";
import * as knowledge from "@/server/services/knowledge";
import * as projects from "@/server/services/projects";
import * as finder from "@/server/services/finder";
import * as blueprint from "@/server/services/blueprint";
import * as artifacts from "@/server/services/artifacts";
import * as skills from "@/server/services/skills";
import * as deployments from "@/server/services/deployments";
import { getJob } from "@/server/jobs";
import { validateSkillMd } from "@/lib/skill-validate";
import { DEMO_PROJECT } from "@/server/seed/content";
import { ARTIFACT_DEFS } from "@/lib/artifact-catalog";
import { recentActivity } from "@/server/services/workspace";

let alice: Ctx;
let bob: Ctx;

async function expectError(promise: Promise<unknown>, code: string, message?: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code} but the call succeeded`).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (message) expect((error as AppError).message).toMatch(message);
  return error as AppError;
}

beforeAll(async () => {
  ({ alice, bob } = await freshDatabase());
});
afterAll(async () => {
  await closeDb();
});

describe("knowledge intelligence", () => {
  it("seeds demo knowledge as unreviewed drafts with provenance", async () => {
    const { items, total } = await knowledge.listItems(alice, { limit: 200 });
    expect(total).toBe(41);
    expect(items.every((i) => i.status === "draft" && i.isDemo && i.lastVerifiedAt === null)).toBe(true);
    const detail = await knowledge.getItemDetail(alice, "fabric-lakehouse-enterprise-bi");
    expect(detail.sources.length).toBe(2);
    expect(detail.sources.every((s) => s.source.lastVerifiedAt === null)).toBe(true);
    expect(detail.related.some((r) => r.type === "implements" && r.other.slug === "medallion-architecture")).toBe(true);
  });

  it("finds items by full text and explains the match", async () => {
    const hits = await knowledge.search(alice, "private endpoints databricks unity catalog");
    expect(hits[0]?.item.slug).toBe("azure-databricks-lakehouse-private");
    expect(hits[0]?.why.length).toBeGreaterThan(0);
    expect(hits[0]?.snippet).toContain("«");
    const expanded = await knowledge.search(alice, "snowflake dbt", { expand: true });
    expect(expanded.some((h) => h.via)).toBe(true);
    expect(await knowledge.search(alice, "zzzqqq-nothing")).toEqual([]);
  });

  it("creates, versions and guards verified content", async () => {
    const item = await knowledge.createItem(alice, { title: "Row-level security testing", type: "technique", summary: "How to test RLS.", sections: [], attributes: {}, tags: ["Security"], sourceType: "internal-experience", confidence: 0.7 });
    expect(item.slug).toBe("row-level-security-testing");
    expect(item.status).toBe("draft");
    await expectError(knowledge.setItemStatus(alice, item.id, "verified"), "precondition_failed", /source/);
    await knowledge.createSource(alice, { title: "Internal test record", url: "", publisher: "", sourceType: "internal-experience", itemId: item.id });
    const verified = await knowledge.setItemStatus(alice, item.id, "verified");
    expect(verified.status).toBe("verified");
    expect(verified.lastVerifiedAt).toBeInstanceOf(Date);
    expect(verified.reviewerId).toBe(alice.userId);

    const edit = { title: item.title, type: "technique" as const, summary: "Changed.", sections: [], attributes: {}, tags: [], sourceType: "internal-experience" as const, confidence: null };
    await expectError(knowledge.updateItem(alice, item.id, { ...edit, expectedVersion: 1, confirmVerifiedEdit: false }), "precondition_failed", /verified/);
    await expectError(knowledge.updateItem(alice, item.id, { ...edit, expectedVersion: 7, confirmVerifiedEdit: true }), "conflict");
    const updated = await knowledge.updateItem(alice, item.id, { ...edit, expectedVersion: 1, confirmVerifiedEdit: true });
    expect(updated.version).toBe(2);
    expect(updated.status).toBe("draft");
    const detail = await knowledge.getItemDetail(alice, item.id);
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0]?.snapshot.summary).toBe("How to test RLS.");
    expect(detail.versions[0]?.snapshot.status).toBe("verified");
  });

  it("imports a document into the review queue and refuses duplicates and unsupported files", async () => {
    const content = "# Lakehouse naming conventions\n\nA short guide to naming lakehouse objects.\n\n## Rules\n\nUse lowercase with underscores.\n\n## Examples\n\nbronze_sales_orders";
    const result = await knowledge.importDocument(alice, { fileName: "naming.md", content, type: "best-practice", sourceType: "internal-experience", url: "" });
    expect(result.item.status).toBe("draft");
    expect(result.item.origin).toBe("imported");
    expect(result.item.sections.map((s) => s.title)).toEqual(["Rules", "Examples"]);
    expect(result.source.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.chunks).toBeGreaterThan(0);
    await expectError(knowledge.importDocument(alice, { fileName: "naming.md", content, type: "best-practice", sourceType: "internal-experience", url: "" }), "conflict");
    await expectError(knowledge.importDocument(alice, { fileName: "slides.pptx", content, type: "concept", sourceType: "unspecified", url: "" }), "validation_error");
  });

  it("returns a filtered graph and a focused neighbourhood", async () => {
    const all = await knowledge.getGraph(alice);
    expect(all.nodes.length).toBeGreaterThan(40);
    expect(all.edges.length).toBe(68);
    const fabric = all.nodes.find((n) => n.slug === "microsoft-fabric")!;
    const focused = await knowledge.getGraph(alice, { focusId: fabric.id, depth: 1 });
    expect(focused.nodes.length).toBeLessThan(all.nodes.length);
    expect(focused.nodes.some((n) => n.slug === "power-bi")).toBe(true);
    const onlyScenarios = await knowledge.getGraph(alice, { types: ["scenario"] });
    expect(onlyScenarios.nodes.every((n) => n.type === "scenario")).toBe(true);
  });

  it("answers by quoting stored passages with their sources", async () => {
    const answer = await knowledge.ask(alice, "How does the medallion architecture work?");
    expect(answer.mode).toBe("extractive");
    expect(answer.passages[0]?.item.slug).toBe("medallion-architecture");
    expect(answer.passages[0]?.sources.length).toBeGreaterThan(0);
  });
});

describe("project to deployment flow", () => {
  let projectId: string;
  let revisionId: string;
  let manifestId: string;
  let planId: string;
  let environmentId: string;

  it("creates a project and extracts requirements without inventing any", async () => {
    const project = await projects.createProject(alice, DEMO_PROJECT);
    projectId = project.id;
    await expectError(finder.runFinder(alice, projectId), "precondition_failed", /approve/);
    const { extraction } = await projects.extractRequirements(alice, projectId);
    expect(extraction.provider).toBe("local-rules");
    const rows = await projects.getRequirements(alice, projectId);
    expect(rows).toHaveLength(17);
    const get = (field: string) => rows.find((r) => r.field === field)!;
    expect(get("target_platform").tokens).toEqual(expect.arrayContaining(["fabric", "azure"]));
    expect(get("target_platform").evidence).toMatch(/Microsoft Fabric/);
    expect(get("network").state).toBe("unknown");
    expect(get("network").question).toMatch(/\?$/);
    expect(get("cicd").state).toBe("unknown");
    expect((await projects.getProject(alice, projectId)).requirementsStatus).toBe("draft");
  });

  it("keeps user edits when extraction is re-run and requires re-approval after edits", async () => {
    await projects.saveRequirements(alice, projectId, [
      { field: "network", state: "known", value: "On-premises gateway, no private endpoints required" },
      { field: "availability", state: "not-applicable", value: "" },
    ]);
    const error = await expectError(projects.saveRequirements(alice, projectId, [{ field: "cicd", state: "known", value: "  " }]), "validation_error");
    expect(error.fieldErrors?.cicd).toBeDefined();
    await projects.extractRequirements(alice, projectId);
    const rows = await projects.getRequirements(alice, projectId);
    expect(rows.find((r) => r.field === "network")?.value).toMatch(/gateway/);
    expect(rows.find((r) => r.field === "network")?.origin).toBe("user");
    expect(rows.find((r) => r.field === "network")?.tokens).toContain("hybrid-connectivity");
    expect(rows.find((r) => r.field === "availability")?.state).toBe("not-applicable");
    const approved = await projects.approveRequirements(alice, projectId);
    expect(approved.requirementsStatus).toBe("approved");
  });

  it("ranks candidates with a full factor breakdown, sources, gaps and labels", async () => {
    const { candidates, excluded, run } = await finder.runFinder(alice, projectId);
    expect(run).toBe(1);
    expect(candidates[0]?.title).toBe("Microsoft Fabric lakehouse for enterprise BI");
    expect(excluded.map((e) => e.title)).toEqual(expect.arrayContaining(["AWS lakehouse with S3, Glue, Athena and Redshift", "BigQuery analytics platform on Google Cloud"]));
    for (const c of candidates) {
      expect(c.factors).toHaveLength(7);
      expect(c.factors.every((f) => f.evidence.length + f.gaps.length > 0)).toBe(true);
      expect(["exact-reference", "adapted-reference", "assumption"]).toContain(c.label);
      expect(c.sourceIds.length).toBeGreaterThan(0);
    }
    const top = candidates[0]!;
    expect(top.score).toBeGreaterThan(candidates[1]!.score);
    expect(top.confidence).toBeLessThanOrEqual(0.75); // draft reference
    expect(top.assumptions.join(" ")).toMatch(/draft/);
    expect(top.relatedItemIds.length).toBeGreaterThan(3);
    expect(top.costDrivers.length).toBeGreaterThan(0);
    const databricks = candidates.find((c) => c.title.startsWith("Azure Databricks"))!;
    expect(databricks.label).toBe("adapted-reference");
    expect(databricks.gaps.join(" ")).toMatch(/instead of the stated/);

    const second = await finder.runFinder(alice, projectId, { workload: 0, platform: 0, security: 0, complexity: 0, migration: 0, cost: 0, team: 100 });
    expect(second.run).toBe(2);
    expect(second.candidates[0]?.weights.team).toBe(100);
    const listed = await finder.listCandidates(alice, projectId);
    expect(listed.run).toBe(2);
    expect(listed.excluded.length).toBe(2);
    expect((await finder.listCandidates(alice, projectId, 1)).candidates[0]?.id).toBe(candidates[0]?.id);
  });

  it("falls back to a clearly labelled generated proposal when no scenario is available", async () => {
    const p = await projects.createProject(bob, { name: "Empty workspace project", description: "", context: "" });
    await projects.saveRequirements(bob, p.id, [{ field: "source_systems", state: "known", value: "Oracle and SAP" }]);
    await projects.approveRequirements(bob, p.id);
    const { candidates } = await finder.runFinder(bob, p.id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.label).toBe("generated-proposal");
    expect(candidates[0]?.score).toBe(0);
    expect(candidates[0]?.confidence).toBe(0);
    expect(candidates[0]?.diagram.nodes.every((n) => n.provenance.origin === "generated")).toBe(true);
    expect(candidates[0]?.diagram.nodes.filter((n) => n.kind === "source").map((n) => n.label)).toEqual(["Oracle", "SAP"]);
    expect(candidates[0]?.diagram.nodes.every((n) => !n.technology)).toBe(true);
  });

  it("creates an editable blueprint with optimistic locking", async () => {
    const { candidates } = await finder.listCandidates(alice, projectId, 1);
    const revision = await blueprint.createRevisionFromCandidate(alice, projectId, candidates[0]!.id);
    revisionId = revision.id;
    expect(revision.version).toBe(1);
    expect(revision.status).toBe("draft");
    expect(revision.sections).toHaveLength(20);
    expect(revision.diagram.nodes.length).toBe(12);
    expect(revision.diagram.nodes.every((n) => n.provenance.origin === "reference" && n.provenance.itemId)).toBe(true);
    expect(revision.sections.find((s) => s.key === "l3-deployment")?.origin).toBe("assumption");
    expect(revision.sections.find((s) => s.key === "sizing-cost")?.body).toMatch(/does not estimate prices/);
    expect(revision.sections.find((s) => s.key === "context-requirements")?.body).toMatch(/CI\/CD:\*\* TODO — unknown/);
    const decisions = await blueprint.listDecisions(alice, projectId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.status).toBe("proposed");

    const diagram = structuredClone(revision.diagram);
    diagram.nodes.push({ id: "alerts", kind: "operations", label: "Alerting", description: "Pipeline failure alerts", config: {}, provenance: { origin: "user" }, requirementFields: ["availability"], position: { x: 10, y: 10 } });
    diagram.edges.push({ id: "alerts__pipelines", source: "alerts", target: "pipelines", label: "watch", kind: "control", provenance: { origin: "user" } });
    const saved = await blueprint.updateRevision(alice, projectId, revisionId, { lockVersion: 1, diagram });
    expect(saved.lockVersion).toBe(2);
    expect(saved.diagram.nodes).toHaveLength(13);
    await expectError(blueprint.updateRevision(alice, projectId, revisionId, { lockVersion: 1, title: "stale write" }), "conflict");
    await expectError(artifacts.generateArtifacts(alice, projectId, { revisionId, types: ["hld"], idempotencyKey: "too-early-1" }), "precondition_failed", /approved/);
  });

  it("approves a revision, makes it immutable and supersedes the previous one", async () => {
    await expectError(blueprint.approveRevision({ ...alice, role: "editor" }, projectId, revisionId, { lockVersion: 2, note: "" }), "forbidden");
    const approved = await blueprint.approveRevision(alice, projectId, revisionId, { lockVersion: 2, note: "Reviewed with the client." });
    expect(approved.status).toBe("approved");
    expect(approved.contentHash).toMatch(/^[0-9a-f]{64}$/);
    await expectError(blueprint.updateRevision(alice, projectId, revisionId, { lockVersion: 3, title: "edit after approval" }), "precondition_failed", /no longer be edited/);

    const v2 = await blueprint.cloneRevision(alice, projectId, revisionId);
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("draft");
    await blueprint.approveRevision(alice, projectId, v2.id, { lockVersion: 1, note: "" });
    expect((await blueprint.getRevision(alice, projectId, revisionId)).status).toBe("superseded");
    revisionId = v2.id;
  });

  it("generates traceable artifacts and a manifest; the job is idempotent", async () => {
    const types = ARTIFACT_DEFS.map((d) => d.type);
    const job = await artifacts.generateArtifacts(alice, projectId, { revisionId, types, idempotencyKey: "gen-run-0001" }, { wait: true });
    const finished = await getJob(alice, job.id);
    expect(finished.status).toBe("succeeded");
    expect(finished.result?.generated).toBe(16);
    expect(finished.result?.failedValidation).toEqual([]);
    manifestId = finished.result!.manifestId as string;
    const again = await artifacts.generateArtifacts(alice, projectId, { revisionId, types, idempotencyKey: "gen-run-0001" }, { wait: true });
    expect(again.id).toBe(job.id);
    expect(await artifacts.listManifests(alice, projectId)).toHaveLength(1);

    const { manifest, files } = await artifacts.manifestFiles(alice, projectId, manifestId);
    expect(manifest.body.architectureRevisionId).toBe(revisionId);
    expect(files).toHaveLength(16);
    for (const f of files) {
      expect(f.actualChecksum).toBe(f.checksum);
      expect(f.templateVersion).toBeTruthy();
      expect(f.sourceItemIds.length).toBeGreaterThan(0);
      expect(f.validationStatus).not.toBe("failed");
    }
    const hld = files.find((f) => f.type === "hld")!;
    expect(hld.content).toContain(revisionId);
    expect(hld.content).toContain("Generated — not validated");
    expect(hld.content).toContain("https://learn.microsoft.com/en-us/fabric/");
    const tf = files.find((f) => f.type === "iac")!;
    expect(tf.content).toContain('provider "azurerm"');
    expect(tf.content).not.toMatch(/^resource /m);
    expect(tf.content).toContain("PLACEHOLDER");
    expect(JSON.parse(files.find((f) => f.type === "blueprint-json")!.content).architectureRevision.id).toBe(revisionId);
    expect(files.find((f) => f.type === "pipeline")!.content).not.toMatch(/terraform apply/);
  });

  it("never overwrites a hand-edited artifact without an explicit choice", async () => {
    const list = await artifacts.listArtifacts(alice, projectId);
    const runbook = list.find((a) => a.artifact.type === "runbook")!;
    const edited = await artifacts.editArtifact(alice, projectId, runbook.artifact.id, { content: "# Runbook\n\nOur own procedure.\n", expectedVersion: 1 });
    expect(edited.version).toBe(2);
    expect(edited.origin).toBe("user-edit");
    await expectError(artifacts.editArtifact(alice, projectId, runbook.artifact.id, { content: "x", expectedVersion: 1 }), "conflict");

    const error = await expectError(artifacts.generateArtifacts(alice, projectId, { revisionId, types: ["runbook", "hld"], idempotencyKey: "gen-run-0002" }), "conflict", /edited by hand/);
    expect((error.details?.edited as { type: string }[])[0]?.type).toBe("runbook");

    const keep = await artifacts.generateArtifacts(alice, projectId, { revisionId, types: ["runbook", "hld"], onEdited: "keep", idempotencyKey: "gen-run-0003" }, { wait: true });
    expect((await getJob(alice, keep.id)).result?.kept).toEqual(["runbook"]);
    expect((await artifacts.getArtifact(alice, projectId, runbook.artifact.id)).revision.content).toContain("Our own procedure");
    const replace = await artifacts.generateArtifacts(alice, projectId, { revisionId, types: ["runbook"], onEdited: "replace", idempotencyKey: "gen-run-0004" }, { wait: true });
    expect((await getJob(alice, replace.id)).status).toBe("succeeded");
    const latest = await artifacts.getArtifact(alice, projectId, runbook.artifact.id);
    expect(latest.revision.version).toBe(3);
    expect(latest.revision.origin).toBe("generated");
    expect((await artifacts.getArtifact(alice, projectId, runbook.artifact.id, 2)).revision.content).toContain("Our own procedure");
  });

  it("exports a ZIP whose files match the manifest and contain no secrets", async () => {
    const { bytes, fileName } = await artifacts.exportManifestZip(alice, projectId, manifestId);
    expect(fileName).toMatch(/\.zip$/);
    const entries = unzipSync(bytes);
    const names = Object.keys(entries);
    expect(names).toEqual(expect.arrayContaining(["README.md", "manifest.json", "docs/hld.md", "iac/main.tf", "diagrams/architecture.mmd"]));
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]!));
    expect(manifest.files).toHaveLength(16);
    const { findSecrets } = await import("@/lib/content-checks");
    for (const name of names) expect(findSecrets(strFromU8(entries[name]!)), name).toEqual([]);
  });

  it("generates a valid, composable skill package", async () => {
    const job = await skills.generateSkills(alice, projectId, { revisionId, idempotencyKey: "skills-run-01" }, { wait: true });
    const finished = await getJob(alice, job.id);
    expect(finished.status).toBe("succeeded");
    expect(finished.result?.invalid).toEqual([]);
    const list = await skills.listSkills(alice, projectId);
    const kinds = list.map((s) => s.skill.kind);
    expect(kinds).toEqual(expect.arrayContaining(["platform", "pattern", "scenario", "validation"]));
    for (const s of list) {
      expect(validateSkillMd(s.latest!.skillMd, s.skill.name)).toMatchObject({ valid: true });
      expect(s.skill.name.length).toBeLessThanOrEqual(64);
      expect(s.latest!.files.some((f) => f.path === "manifest.json")).toBe(true);
      expect(s.latest!.architectureRevisionId).toBe(revisionId);
    }
    const scenario = list.find((s) => s.skill.kind === "scenario")!;
    expect(scenario.dependsOn.length).toBeGreaterThan(1);
    expect(list.find((s) => s.skill.kind === "validation")!.dependsOn[0]?.name).toBe(scenario.skill.name);

    const bad = await skills.editSkill(alice, projectId, scenario.skill.id, { skillMd: "# broken", expectedVersion: 1 });
    expect(bad.validation.valid).toBe(false);
    await expectError(skills.createPackage(alice, projectId), "precondition_failed", /validation errors/);
    await expectError(skills.generateSkills(alice, projectId, { revisionId, idempotencyKey: "skills-run-02" }), "conflict");
    await skills.generateSkills(alice, projectId, { revisionId, onEdited: "replace", idempotencyKey: "skills-run-03" }, { wait: true });

    const pkg = await skills.createPackage(alice, projectId);
    const order = (pkg.manifest as { executionOrder: string[] }).executionOrder;
    expect(order.indexOf(scenario.skill.name)).toBeLessThan(order.findIndex((n) => n.startsWith("validate-")));
    expect(order.findIndex((n) => n.startsWith("platform-"))).toBeLessThan(order.indexOf(scenario.skill.name));
    const { bytes } = await skills.exportPackageZip(alice, projectId, pkg.id);
    const names = Object.keys(unzipSync(bytes));
    expect(names).toEqual(expect.arrayContaining(["README.md", "manifest.json", `${scenario.skill.name}/SKILL.md`, `${scenario.skill.name}/references/components.md`, `${scenario.skill.name}/manifest.json`]));
  });

  it("plans a deployment and runs a dry-run that changes nothing and fakes nothing", async () => {
    const environment = await projects.createEnvironment(alice, projectId, { name: "prod-eu", kind: "production", platform: "Microsoft Fabric", notes: "" });
    environmentId = environment.id;
    const plan = await deployments.createPlan(alice, projectId, { environmentId, manifestId });
    planId = plan.id;
    expect(plan.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.body.stages.map((s) => s.id)).toEqual(["static", "security", "preflight", "deploy", "smoke", "operational"]);
    expect(plan.body.impact.costNote).toMatch(/No cost estimate/);

    await expectError(deployments.approvePlan(alice, projectId, planId, { planHash: plan.planHash, note: "go", expiresInHours: 1, confirmEnvironment: "prod-eu" }), "precondition_failed", /dry-run/);

    const run = await deployments.startRun(alice, projectId, planId, { mode: "dry-run" }, { wait: true });
    const detail = await deployments.getRun(alice, projectId, run.id);
    expect(detail.run.status).toBe("succeeded");
    expect(detail.run.summary).toMatch(/Nothing was changed/);
    expect(detail.run.simulated).toBe(true);
    const byLevel = (level: string) => detail.checks.filter((c) => c.level === level);
    expect(byLevel("static").every((c) => c.status === "passed")).toBe(true);
    expect(byLevel("preflight").every((c) => c.status === "skipped")).toBe(true);
    expect(byLevel("deployment").length).toBeGreaterThan(5);
    expect(byLevel("deployment").every((c) => c.status === "skipped" && /not executed/.test(c.detail))).toBe(true);
    expect(byLevel("functional").every((c) => c.status === "skipped")).toBe(true);
    expect(detail.checks.find((c) => c.name === "Unresolved placeholders")?.status).toBe("warning");
    expect(detail.evidence).toHaveLength(detail.checks.length);
    expect(detail.evidence.every((e) => e.planHash === plan.planHash && e.environment === "prod-eu" && e.architectureRevisionId === revisionId)).toBe(true);
    expect(detail.evidence.every((e) => e.resourceIds.length === 0)).toBe(true);
  });

  it("binds approval to the plan hash, environment and expiry; execution needs it", async () => {
    const plan = await deployments.getPlan(alice, projectId, planId);
    await expectError(deployments.startRun(alice, projectId, planId, { mode: "execute" }), "forbidden", /approval/);
    await expectError(deployments.approvePlan(alice, projectId, planId, { planHash: "0".repeat(64), note: "go", expiresInHours: 1, confirmEnvironment: "prod-eu" }), "validation_error");
    await expectError(deployments.approvePlan(alice, projectId, planId, { planHash: plan.planHash, note: "go", expiresInHours: 1, confirmEnvironment: "dev" }), "validation_error");
    await expectError(deployments.approvePlan({ ...alice, role: "editor" }, projectId, planId, { planHash: plan.planHash, note: "go", expiresInHours: 1, confirmEnvironment: "prod-eu" }), "forbidden");

    const expired = await deployments.approvePlan(alice, projectId, planId, { planHash: plan.planHash, note: "short window", expiresInHours: 1, confirmEnvironment: "prod-eu" });
    await expectError(deployments.startRun(alice, projectId, planId, { mode: "execute", approvalId: expired.id }, { now: new Date(Date.now() + 2 * 3600_000) }), "forbidden", /expired/);

    const approval = await deployments.approvePlan(alice, projectId, planId, { planHash: plan.planHash, note: "approved after dry-run review", expiresInHours: 1, confirmEnvironment: "prod-eu" });
    const run = await deployments.startRun(alice, projectId, planId, { mode: "execute", approvalId: approval.id }, { wait: true });
    const detail = await deployments.getRun(alice, projectId, run.id);
    expect(detail.run.status).toBe("succeeded");
    expect(detail.run.summary).toMatch(/Simulated execution.*No resources were created/);
    expect(detail.checks.filter((c) => c.level === "deployment").every((c) => c.status === "skipped" && /nothing was created/.test(c.detail))).toBe(true);
    expect(detail.evidence.filter((e) => e.simulated).length).toBeGreaterThan(0);
    await expectError(deployments.startRun(alice, projectId, planId, { mode: "execute", approvalId: approval.id }), "forbidden", /already used/);
  });

  it("invalidates approvals when the plan changes", async () => {
    const old = await deployments.getPlan(alice, projectId, planId);
    await deployments.startRun(alice, projectId, planId, { mode: "dry-run" }, { wait: true });
    const approval = await deployments.approvePlan(alice, projectId, planId, { planHash: old.planHash, note: "approve old plan", expiresInHours: 1, confirmEnvironment: "prod-eu" });
    const job = await artifacts.generateArtifacts(alice, projectId, { revisionId, types: ["hld", "runbook"], onEdited: "replace", idempotencyKey: "gen-run-0005" }, { wait: true });
    const newManifest = (await getJob(alice, job.id)).result!.manifestId as string;
    const next = await deployments.createPlan(alice, projectId, { environmentId, manifestId: newManifest });
    expect(next.planHash).not.toBe(old.planHash);
    expect((await deployments.getPlan(alice, projectId, planId)).status).toBe("superseded");
    await expectError(deployments.startRun(alice, projectId, planId, { mode: "execute", approvalId: approval.id }), "precondition_failed", /replaced/);
    await expectError(deployments.startRun(alice, projectId, next.id, { mode: "execute", approvalId: approval.id }), "forbidden");
  });

  it("fails a dry-run when a file no longer matches its manifest checksum", async () => {
    const list = await deployments.listDeployments(alice, projectId);
    const current = list.find((d) => d.plan.status === "planned")!;
    const { files } = await artifacts.manifestFiles(alice, projectId, current.plan.manifestId);
    await getDb().update(schema.artifactRevisions).set({ content: "tampered" }).where(eq(schema.artifactRevisions.id, files[0]!.artifactRevisionId));
    const run = await deployments.startRun(alice, projectId, current.plan.id, { mode: "dry-run" }, { wait: true });
    const detail = await deployments.getRun(alice, projectId, run.id);
    expect(detail.run.status).toBe("failed");
    expect(detail.checks.some((c) => c.status === "failed" && c.name.startsWith("Integrity"))).toBe(true);
    expect(detail.checks.filter((c) => c.level === "deployment").every((c) => c.status === "skipped")).toBe(true);
  });

  it("records audit events for the whole flow", async () => {
    const events = await recentActivity(alice, { projectId, limit: 100 });
    const actions = events.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["project.create", "requirements.extract", "requirements.approve", "finder.run", "revision.create", "revision.approve", "artifacts.generate", "artifacts.export", "skills.generate", "skills.package", "deployment.plan", "deployment.approve", "deployment.run.dry-run", "deployment.run.execute"]));
  });

  it("denies all cross-workspace access", async () => {
    const item = await knowledge.getItem(alice, "medallion-architecture");
    const revs = await blueprint.listRevisions(alice, projectId);
    const arts = await artifacts.listArtifacts(alice, projectId);
    const deps = await deployments.listDeployments(alice, projectId);
    const sk = await skills.listSkills(alice, projectId);
    const pkgs = await skills.listPackages(alice, projectId);
    const calls: (() => Promise<unknown>)[] = [
      () => projects.getProject(bob, projectId),
      () => projects.updateProject(bob, projectId, { name: "hijack", description: "", context: "" }),
      () => projects.getRequirements(bob, projectId),
      () => projects.saveRequirements(bob, projectId, []),
      () => projects.listEnvironments(bob, projectId),
      () => finder.runFinder(bob, projectId),
      () => finder.listCandidates(bob, projectId),
      () => blueprint.listRevisions(bob, projectId),
      () => blueprint.getRevision(bob, projectId, revs[0]!.id),
      () => blueprint.listDecisions(bob, projectId),
      () => artifacts.listArtifacts(bob, projectId),
      () => artifacts.getArtifact(bob, projectId, arts[0]!.artifact.id),
      () => artifacts.exportManifestZip(bob, projectId, manifestId),
      () => skills.listSkills(bob, projectId),
      () => skills.editSkill(bob, projectId, sk[0]!.skill.id, { skillMd: "x", expectedVersion: 1 }),
      () => skills.exportPackageZip(bob, projectId, pkgs[0]!.id),
      () => deployments.listDeployments(bob, projectId),
      () => deployments.startRun(bob, projectId, deps[0]!.plan.id, { mode: "dry-run" }),
      () => deployments.getRun(bob, projectId, deps[0]!.runs[0]!.id),
      () => knowledge.getItem(bob, item.id),
      () => knowledge.getItem(bob, "medallion-architecture"),
      () => knowledge.updateItem(bob, item.id, { title: "x y z", type: "concept", summary: "s", sections: [], attributes: {}, tags: [], sourceType: "unspecified", confidence: null, expectedVersion: 1, confirmVerifiedEdit: true }),
      () => knowledge.setItemStatus(bob, item.id, "archived"),
    ];
    for (const [index, call] of calls.entries()) {
      const error = await call().then(() => null, (e: unknown) => e);
      expect(error, `call ${index} should be denied`).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("not_found");
    }
    // Bob's own project cannot reference Alice's resources either.
    const bobProject = await projects.createProject(bob, { name: "Bob project", description: "", context: "" });
    await expectError(blueprint.getRevision(bob, bobProject.id, revs[0]!.id), "not_found");
    await expectError(deployments.getPlan(bob, bobProject.id, deps[0]!.plan.id), "not_found");
    await expectError(knowledge.addRelationship(bob, { fromId: item.id, toId: item.id, type: "related_to" }), "validation_error");
    expect((await knowledge.listItems(bob)).total).toBe(0);
    expect(await knowledge.search(bob, "medallion")).toEqual([]);
    expect((await knowledge.getGraph(bob)).nodes).toEqual([]);
    expect(await getJobSafe(bob)).toBe("not_found");
    await expectError(projects.createProject({ ...bob, role: "viewer" }, { name: "Viewer attempt", description: "", context: "" }), "forbidden");
  });

  async function getJobSafe(ctx: Ctx) {
    const [job] = await getDb().select().from(schema.generationJobs).limit(1);
    return getJob(ctx, job!.id).then(() => "found", (e: AppError) => e.code);
  }
});
