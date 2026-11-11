import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { redact } from "@/lib/content-checks";
import type { DeploymentPlanBody, PlanStage, RunLogEntry } from "@/lib/types";
import { audit } from "../audit";
import { assertCanEdit, type Ctx } from "../ctx";
import { hashJson } from "../crypto";
import { getDb, schema } from "../db";
import { AppError, forbidden, notFound, precondition } from "../errors";
import { background } from "../jobs";
import { getDeploymentAdapter } from "../providers";
import { manifestFiles } from "./artifacts";
import { getRevision } from "./blueprint";
import { getEnvironment, getProject } from "./projects";

const plans = schema.deploymentPlans;
const runs = schema.deploymentRuns;
export type Plan = typeof plans.$inferSelect;
export type Run = typeof runs.$inferSelect;

export async function createPlan(ctx: Ctx, projectId: string, input: { environmentId: string; manifestId: string }) {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const environment = await getEnvironment(ctx, projectId, input.environmentId);
  const { manifest, files } = await manifestFiles(ctx, projectId, input.manifestId);
  const revision = await getRevision(ctx, projectId, manifest.architectureRevisionId);
  if (revision.status !== "approved") throw precondition(`This package was generated from blueprint v${revision.version}, which is now ${revision.status}. Generate artifacts from the approved revision and plan from that package.`);
  const adapter = getDeploymentAdapter();
  const components = revision.diagram.nodes.filter((n) => !["source", "consumer"].includes(n.kind));

  const stages: PlanStage[] = [
    { id: "static", name: "Static validation", level: "static", description: "Verify package integrity and file syntax.", changesTarget: false, operations: files.map((f) => ({ id: `static:${f.path}`, description: `Validate ${f.path}`, artifactPath: f.path, changeType: "none", destructive: false })) },
    { id: "security", name: "Security checks", level: "security", description: "Scan for secrets and unresolved placeholders.", changesTarget: false, operations: [{ id: "security:scan", description: "Scan the package for credentials and placeholders", changeType: "none", destructive: false }] },
    { id: "preflight", name: "Preflight", level: "preflight", description: "Authentication, permissions, quotas and prerequisites in the target environment.", changesTarget: false, operations: [{ id: "preflight:access", description: `Check access to ${environment.name}`, changeType: "none", destructive: false }] },
    { id: "deploy", name: "Deploy components", level: "deployment", description: "Create the components of the approved architecture.", changesTarget: true, operations: components.map((n) => ({ id: `deploy:${n.id}`, description: `Create ${n.label}${n.technology ? ` (${n.technology})` : ""}`, artifactPath: files.find((f) => f.type === "iac")?.path, changeType: "create", destructive: false })) },
    { id: "smoke", name: "Smoke tests", level: "functional", description: "Connectivity and a sample pipeline run.", changesTarget: false, operations: [{ id: "smoke:flows", description: "Test the data flows with sample data", changeType: "none", destructive: false }] },
    { id: "operational", name: "Operational readiness", level: "operational", description: "Runbook, rollback checklist, monitoring and backup.", changesTarget: false, operations: [{ id: "operational:readiness", description: "Check operational readiness", changeType: "none", destructive: false }] },
  ];

  const body: DeploymentPlanBody = {
    schemaVersion: 1,
    environment: { id: environment.id, name: environment.name, kind: environment.kind, platform: environment.platform },
    manifestId: manifest.id,
    manifestHash: manifest.hash,
    architectureRevisionId: revision.id,
    adapter: { name: adapter.name, simulated: adapter.simulated, supportedOperations: adapter.capabilities.supportedOperations, requiredScopes: adapter.capabilities.requiredScopes, rollbackLimitations: adapter.capabilities.rollbackLimitations },
    stages,
    impact: {
      summary: `${components.length} component(s) of blueprint v${revision.version} would be created in ${environment.name} (${environment.kind}).`,
      componentsAffected: components.map((n) => n.label),
      costNote: "No cost estimate: DataBrain holds no pricing data. Size and price the components before approving a real execution.",
    },
    rollback: adapter.simulated
      ? ["The configured adapter is a simulator: it changes nothing, so there is nothing to roll back.", "For a real deployment, follow migration/cutover-rollback-checklist.md in the package."]
      : ["Follow migration/cutover-rollback-checklist.md in the package.", ...adapter.capabilities.rollbackLimitations],
    prerequisites: [...adapter.capabilities.prerequisites, "A successful dry-run of this exact plan before any approval."],
  };

  const db = getDb();
  return db.transaction(async (tx) => {
    // A new plan for the same environment replaces the old one; approvals of the old plan no longer apply.
    await tx.update(plans).set({ status: "superseded" }).where(and(eq(plans.projectId, project.id), eq(plans.environmentId, environment.id), eq(plans.status, "planned")));
    const [plan] = await tx.insert(plans).values({ projectId: project.id, environmentId: environment.id, manifestId: manifest.id, architectureRevisionId: revision.id, adapter: adapter.name, body, planHash: hashJson(body), createdBy: ctx.userId }).returning();
    await audit(ctx, { action: "deployment.plan", entityType: "deployment_plan", entityId: plan!.id, projectId: project.id, summary: `Created deployment plan for ${environment.name}`, metadata: { planHash: plan!.planHash } }, tx);
    return plan!;
  });
}

export async function getPlan(ctx: Ctx, projectId: string, planId: string): Promise<Plan> {
  const project = await getProject(ctx, projectId);
  const [plan] = await getDb().select().from(plans).where(and(eq(plans.id, planId), eq(plans.projectId, project.id))).limit(1);
  if (!plan) throw notFound("Deployment plan");
  return plan;
}

export async function listDeployments(ctx: Ctx, projectId: string) {
  const project = await getProject(ctx, projectId);
  const db = getDb();
  const planRows = await db.select().from(plans).where(eq(plans.projectId, project.id)).orderBy(desc(plans.createdAt));
  const ids = planRows.map((p) => p.id);
  const [runRows, approvalRows] = ids.length
    ? await Promise.all([db.select().from(runs).where(inArray(runs.planId, ids)).orderBy(desc(runs.createdAt)), db.select().from(schema.approvals).where(inArray(schema.approvals.planId, ids)).orderBy(desc(schema.approvals.createdAt))])
    : [[], []];
  return planRows.map((plan) => ({ plan, runs: runRows.filter((r) => r.planId === plan.id), approvals: approvalRows.filter((a) => a.planId === plan.id) }));
}

/** Approve execution of one exact plan in one environment. The approval dies if the plan changes or time runs out. */
export async function approvePlan(ctx: Ctx, projectId: string, planId: string, input: { planHash: string; note: string; expiresInHours: number; confirmEnvironment: string }) {
  assertCanEdit(ctx);
  if (ctx.role !== "owner") throw forbidden("Only a workspace owner can approve a deployment.");
  const plan = await getPlan(ctx, projectId, planId);
  if (plan.status !== "planned") throw precondition("This plan was replaced by a newer one. Review and approve the current plan.");
  if (hashJson(plan.body) !== plan.planHash) throw precondition("The stored plan no longer matches its hash. Create a new plan.");
  if (input.planHash !== plan.planHash) throw new AppError("validation_error", "The plan hash does not match this plan.", { planHash: ["Copy the hash shown on the plan you reviewed."] });
  if (input.confirmEnvironment.trim() !== plan.body.environment.name) throw new AppError("validation_error", "Environment name does not match.", { confirmEnvironment: [`Type “${plan.body.environment.name}” to confirm the target.`] });
  const db = getDb();
  const [dryRun] = await db.select({ id: runs.id }).from(runs).where(and(eq(runs.planId, plan.id), eq(runs.mode, "dry-run"), eq(runs.status, "succeeded"), eq(runs.planHash, plan.planHash))).limit(1);
  if (!dryRun) throw precondition("Run a dry-run of this plan and review its results before approving execution.");

  const [approval] = await db
    .insert(schema.approvals)
    .values({ planId: plan.id, planHash: plan.planHash, environmentId: plan.environmentId, scope: { mode: "execute", environmentKind: plan.body.environment.kind, stageIds: plan.body.stages.map((s) => s.id) }, note: input.note, approvedBy: ctx.userId, expiresAt: new Date(Date.now() + input.expiresInHours * 3600_000) })
    .returning();
  await audit(ctx, { action: "deployment.approve", entityType: "approval", entityId: approval!.id, projectId, summary: `Approved execution of plan ${plan.planHash.slice(0, 12)} in ${plan.body.environment.name}`, metadata: { planHash: plan.planHash, expiresAt: approval!.expiresAt } });
  return approval!;
}

export async function startRun(ctx: Ctx, projectId: string, planId: string, input: { mode: "dry-run" | "execute"; approvalId?: string }, options: { wait?: boolean; now?: Date } = {}) {
  assertCanEdit(ctx);
  const plan = await getPlan(ctx, projectId, planId);
  if (plan.status !== "planned") throw precondition("This plan was replaced by a newer one. Run the current plan.");
  if (hashJson(plan.body) !== plan.planHash) throw precondition("The stored plan no longer matches its hash. Create a new plan.");
  const adapter = getDeploymentAdapter();
  if (adapter.name !== plan.adapter) throw precondition(`This plan was made for the “${plan.adapter}” adapter, but “${adapter.name}” is configured. Create a new plan.`);
  const db = getDb();
  let approvalId: string | null = null;

  if (input.mode === "execute") {
    if (!input.approvalId) throw forbidden("Execution needs an approval for this exact plan and environment.");
    const now = options.now ?? new Date();
    // Consume the approval atomically: only one run can ever use it.
    const [approval] = await db
      .update(schema.approvals)
      .set({ status: "consumed" })
      .where(and(eq(schema.approvals.id, input.approvalId), eq(schema.approvals.planId, plan.id), eq(schema.approvals.status, "approved")))
      .returning();
    if (!approval) throw forbidden("That approval does not exist for this plan, or was already used or revoked.");
    const invalid = approval.planHash !== plan.planHash ? "The plan changed after it was approved." : approval.environmentId !== plan.environmentId ? "The approval is for a different environment." : approval.expiresAt.getTime() <= now.getTime() ? "The approval has expired." : null;
    if (invalid) {
      await db.update(schema.approvals).set({ status: "revoked" }).where(eq(schema.approvals.id, approval.id));
      throw forbidden(`${invalid} Request a new approval.`);
    }
    approvalId = approval.id;
  }

  const [run] = await db.insert(runs).values({ projectId: plan.projectId, planId: plan.id, approvalId, mode: input.mode, adapter: adapter.name, simulated: adapter.simulated, planHash: plan.planHash, startedBy: ctx.userId }).returning();
  await audit(ctx, { action: `deployment.run.${input.mode}`, entityType: "deployment_run", entityId: run!.id, projectId, summary: `Started ${input.mode} of plan ${plan.planHash.slice(0, 12)} in ${plan.body.environment.name}${adapter.simulated ? " (simulator)" : ""}`, metadata: { planHash: plan.planHash, approvalId } });
  const work = () => execute(ctx, projectId, plan, run!);
  if (options.wait) await work();
  else background(work);
  return run!;
}

async function execute(ctx: Ctx, projectId: string, plan: Plan, run: Run): Promise<void> {
  const db = getDb();
  const log: RunLogEntry[] = [];
  const say = (level: RunLogEntry["level"], message: string, stage?: string) => log.push({ at: new Date().toISOString(), level, stage, message });
  const save = (patch: Partial<Run>) => db.update(runs).set({ ...patch, log }).where(eq(runs.id, run.id));
  try {
    const adapter = getDeploymentAdapter();
    await save({ status: "running", startedAt: new Date() });
    say("info", `${run.mode === "dry-run" ? "Dry-run" : "Execution"} started with adapter “${adapter.name}”${adapter.simulated ? " (simulator — no platform is contacted)" : ""}.`);
    const { files } = await manifestFiles(ctx, projectId, plan.manifestId);
    const context = { mode: run.mode, plan: plan.body, files: files.map((f) => ({ path: f.path, content: f.content, checksum: f.checksum, type: f.type })) };
    let failed = false;

    for (const stage of plan.body.stages) {
      if (failed) {
        say("warn", "Skipped because an earlier stage failed.", stage.id);
        await db.insert(schema.validationChecks).values({ runId: run.id, level: stage.level, name: stage.name, status: "skipped", detail: "Not run: an earlier stage failed." });
        continue;
      }
      say("info", `${stage.name}: started.`, stage.id);
      const result = await adapter.runStage(stage, context);
      for (const check of result.checks) {
        const [row] = await db.insert(schema.validationChecks).values({ runId: run.id, level: stage.level, name: check.name, status: check.status, detail: check.detail }).returning();
        await db.insert(schema.evidenceRecords).values({
          runId: run.id,
          checkId: row!.id,
          actor: `${ctx.userName} via ${adapter.name}`,
          environment: plan.body.environment.name,
          planHash: plan.planHash,
          tool: check.tool,
          command: check.command,
          exitCode: check.exitCode,
          output: redact(check.output).slice(0, 4000),
          result: check.status,
          simulated: adapter.simulated && stage.changesTarget,
          resourceIds: [],
          artifactRefs: check.artifactRefs,
          architectureRevisionId: plan.architectureRevisionId,
        });
      }
      for (const line of result.log) say("info", line, stage.id);
      say(result.status === "failed" ? "error" : "info", `${stage.name}: ${result.status}.`, stage.id);
      if (result.status === "failed") failed = true;
      await save({});
    }

    const checks = await db.select({ status: schema.validationChecks.status }).from(schema.validationChecks).where(eq(schema.validationChecks.runId, run.id));
    const count = (status: string) => checks.filter((c) => c.status === status).length;
    const outcome = `${count("passed")} passed, ${count("warning")} warning, ${count("failed")} failed, ${count("skipped")} skipped`;
    const summary = failed
      ? `Failed: ${outcome}.`
      : run.mode === "dry-run"
        ? `Dry-run finished: ${outcome}. Nothing was changed.`
        : adapter.simulated
          ? `Simulated execution finished: ${outcome}. No resources were created — the configured adapter is a simulator.`
          : `Execution finished: ${outcome}.`;
    say(failed ? "error" : "info", summary);
    await save({ status: failed ? "failed" : "succeeded", finishedAt: new Date(), summary });
  } catch (error) {
    console.error(`[run ${run.id}]`, error);
    say("error", `Run aborted: ${error instanceof Error ? error.message : String(error)}`);
    await save({ status: "failed", finishedAt: new Date(), summary: "The run aborted with an internal error. See the log." });
  }
}

export async function getRun(ctx: Ctx, projectId: string, runId: string) {
  const project = await getProject(ctx, projectId);
  const db = getDb();
  const [run] = await db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.projectId, project.id))).limit(1);
  if (!run) throw notFound("Deployment run");
  const [checks, evidence, plan] = await Promise.all([
    db.select().from(schema.validationChecks).where(eq(schema.validationChecks.runId, run.id)).orderBy(schema.validationChecks.createdAt),
    db.select().from(schema.evidenceRecords).where(eq(schema.evidenceRecords.runId, run.id)).orderBy(schema.evidenceRecords.createdAt),
    getPlan(ctx, projectId, run.planId),
  ]);
  return { run, checks, evidence, plan };
}

export async function revokeApproval(ctx: Ctx, projectId: string, approvalId: string) {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const db = getDb();
  const [row] = await db.select({ approval: schema.approvals }).from(schema.approvals).innerJoin(plans, eq(plans.id, schema.approvals.planId)).where(and(eq(schema.approvals.id, approvalId), eq(plans.projectId, project.id), ne(schema.approvals.status, "consumed"))).limit(1);
  if (!row) throw notFound("Approval");
  await db.update(schema.approvals).set({ status: "revoked" }).where(eq(schema.approvals.id, approvalId));
  await audit(ctx, { action: "deployment.approval.revoke", entityType: "approval", entityId: approvalId, projectId, summary: "Revoked a deployment approval" });
}
