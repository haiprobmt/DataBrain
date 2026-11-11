import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDatabase } from "./setup";
import type { Ctx } from "@/server/ctx";
import { AppError } from "@/server/errors";
import { closeDb, getDb, schema } from "@/server/db";
import { ARTIFACT_DEFS } from "@/lib/artifact-catalog";
import { DEFAULT_LIFECYCLE_TEMPLATE, DEFAULT_TEMPLATE_NAME, type Blocker } from "@/lib/lifecycle";
import { evidenceCreateSchema, riskCreateSchema } from "@/lib/lifecycle-schemas";
import { getJob } from "@/server/jobs";
import { DEMO_PROJECT } from "@/server/seed/content";
import * as artifacts from "@/server/services/artifacts";
import * as blueprint from "@/server/services/blueprint";
import * as deployments from "@/server/services/deployments";
import * as finder from "@/server/services/finder";
import * as lifecycle from "@/server/services/lifecycle";
import * as templates from "@/server/services/lifecycle-templates";
import * as projects from "@/server/services/projects";
import { projectStats, recentActivity } from "@/server/services/workspace";

let alice: Ctx; // owner of workspace A
let bob: Ctx; // owner of workspace B
let carol: Ctx; // editor in workspace A
let dave: Ctx; // editor in workspace A, used as reviewer
let vera: Ctx; // viewer in workspace A

const TOTAL_ITEMS = DEFAULT_LIFECYCLE_TEMPLATE.stages.reduce((n, s) => n + s.checklist.length, 0);

async function expectError(promise: Promise<unknown>, code: string, message?: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${code} but the call succeeded`).toBeInstanceOf(AppError);
  expect((error as AppError).code, (error as AppError).message).toBe(code);
  if (message) expect((error as AppError).message).toMatch(message);
  return error as AppError;
}

async function addMember(workspace: Ctx, name: string, role: Ctx["role"]): Promise<Ctx> {
  const db = getDb();
  const [user] = await db.insert(schema.users).values({ email: `${name.toLowerCase()}@example.test`, name }).returning();
  await db.insert(schema.memberships).values({ userId: user!.id, workspaceId: workspace.workspaceId, role });
  return { ...workspace, userId: user!.id, userName: name, userEmail: user!.email, role, correlationId: randomUUID() };
}

const view = (ctx: Ctx, projectId: string) => lifecycle.getProjectLifecycle(ctx, projectId);
const stageOf = async (ctx: Ctx, projectId: string, key: string) => (await view(ctx, projectId)).stages.find((s) => s.stageKey === key)!;

/** Complete every required checklist item of a stage. */
async function completeChecklist(ctx: Ctx, projectId: string, key: string) {
  const stage = await stageOf(ctx, projectId, key);
  for (const item of stage.checklist.filter((i) => i.isRequired && i.status !== "completed" && i.status !== "waived")) {
    await lifecycle.updateChecklistItem(ctx, projectId, stage.id, item.id, { status: "completed" });
  }
  return stage;
}

/** Take a stage that is in progress through its checklist and approval gate. */
async function passGate(projectId: string, key: string) {
  const stage = await completeChecklist(alice, projectId, key);
  const approval = await lifecycle.requestStageApproval(carol, projectId, stage.id, { reviewerId: dave.userId, note: `Please review ${key}.` });
  return lifecycle.decideStageApproval(dave, projectId, stage.id, approval.id, "approve", "Reviewed.");
}

/** Start a not-started stage and pass its gate. */
async function runStage(projectId: string, key: string) {
  const stage = await stageOf(alice, projectId, key);
  await lifecycle.startStage(alice, projectId, stage.id);
  return passGate(projectId, key);
}

beforeAll(async () => {
  ({ alice, bob } = await freshDatabase());
  carol = await addMember(alice, "Carol", "editor");
  dave = await addMember(alice, "Dave", "editor");
  vera = await addMember(alice, "Vera", "viewer");
});
afterAll(async () => {
  await closeDb();
});

describe("lifecycle templates", () => {
  it("provisions the default template once per workspace, however often and concurrently it is asked", async () => {
    const before = await templates.listLifecycleTemplates(alice);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ name: DEFAULT_TEMPLATE_NAME, isDefault: true, isActive: true, builtIn: true, version: 1, stageCount: 8, projectCount: 0 });
    const ensured = await Promise.all(Array.from({ length: 6 }, () => templates.ensureDefaultLifecycleTemplate(alice)));
    expect(new Set(ensured.map((t) => t.id))).toEqual(new Set([before[0]!.id]));
    expect(await templates.listLifecycleTemplates(alice)).toHaveLength(1);

    const detail = await templates.getLifecycleTemplate(alice, before[0]!.id);
    expect(detail.stages.map((s) => s.stageKey)).toEqual(DEFAULT_LIFECYCLE_TEMPLATE.stages.map((s) => s.stageKey));
    expect(detail.stages.map((s) => s.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(detail.stages.reduce((n, s) => n + s.checklist.length, 0)).toBe(TOTAL_ITEMS);
    expect(detail.stages.find((s) => s.stageKey === "improve_retire")).toMatchObject({ isRequired: false, requiresApproval: true });
    expect(detail.stages.find((s) => s.stageKey === "release")!.readinessRules).toEqual(["required_checklist_complete", "deployment_dry_run_succeeded", "stage_approval_recorded"]);
  });

  it("provisions a workspace that existed before the feature, lazily and without duplicates under concurrency", async () => {
    // Simulate a workspace created before lifecycle templates existed.
    await getDb().delete(schema.lifecycleTemplates).where(eq(schema.lifecycleTemplates.workspaceId, bob.workspaceId));
    const results = await Promise.all(Array.from({ length: 5 }, () => templates.listLifecycleTemplates(bob)));
    for (const list of results) expect(list).toHaveLength(1);
    const rows = await getDb().select().from(schema.lifecycleTemplates).where(eq(schema.lifecycleTemplates.workspaceId, bob.workspaceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: DEFAULT_TEMPLATE_NAME, isDefault: true, createdBy: null });
  });

  it("creates custom templates, enforces unique names, roles and the single default", async () => {
    await expectError(templates.createLifecycleTemplate(vera, { name: "Viewer template", description: "" }), "forbidden");
    const custom = await templates.createLifecycleTemplate(carol, { name: "Lean analytics delivery", description: "Copy of the default." });
    expect(custom).toMatchObject({ isDefault: false, isActive: true, builtIn: false, version: 1 });
    expect(custom.stages).toHaveLength(8);
    expect(custom.stages.reduce((n, s) => n + s.checklist.length, 0)).toBe(TOTAL_ITEMS);
    await expectError(templates.createLifecycleTemplate(carol, { name: "lean ANALYTICS delivery", description: "" }), "conflict", /already exists/);

    const two = await templates.createLifecycleTemplate(alice, {
      name: "Two-step",
      description: "",
      stages: [
        { stageKey: "plan", name: "Plan", description: "", isRequired: true, requiresApproval: false, defaultDurationDays: 5, readinessRules: ["stage_approval_recorded", "required_checklist_complete"], checklist: [{ title: "Agree the plan", description: "", itemType: "task", isRequired: true }] },
        { stageKey: "deliver", name: "Deliver", description: "", isRequired: true, requiresApproval: true, defaultDurationDays: null, readinessRules: [], checklist: [] },
      ],
    });
    // The approval rule follows requiresApproval, whatever the client sent.
    expect(two.stages.map((s) => s.readinessRules)).toEqual([["required_checklist_complete"], ["stage_approval_recorded"]]);

    await expectError(templates.setDefaultLifecycleTemplate(carol, custom.id), "forbidden", /owner/);
    const [builtIn] = (await templates.listLifecycleTemplates(alice)).filter((t) => t.builtIn);
    await expectError(templates.setLifecycleTemplateActive(alice, builtIn!.id, false), "precondition_failed", /default/);
    await templates.setDefaultLifecycleTemplate(alice, custom.id);
    let list = await templates.listLifecycleTemplates(alice);
    expect(list.filter((t) => t.isDefault).map((t) => t.id)).toEqual([custom.id]);
    // An editor cannot change the template that is now the default.
    await expectError(templates.updateLifecycleTemplate(carol, custom.id, { name: custom.name, description: "", stages: custom.stages, expectedVersion: 1 }), "forbidden");

    await templates.setLifecycleTemplateActive(carol, two.id, false);
    await expectError(templates.setDefaultLifecycleTemplate(alice, two.id), "precondition_failed", /Reactivate/);
    const p = await projects.createProject(alice, { name: "Deactivated template project", description: "", context: "" });
    await expectError(lifecycle.initializeProjectLifecycle(alice, p.id, two.id), "precondition_failed", /deactivated/);

    await templates.setDefaultLifecycleTemplate(alice, builtIn!.id);
    list = await templates.listLifecycleTemplates(alice);
    expect(list.filter((t) => t.isDefault).map((t) => t.name)).toEqual([DEFAULT_TEMPLATE_NAME]);
    expect(list[0]!.isDefault).toBe(true);
  });
});

describe("project lifecycle", () => {
  let projectId: string;
  let otherProjectId: string;
  let bobProjectId: string;

  it("leaves a project without a lifecycle readable, with nothing inferred", async () => {
    const project = await projects.createProject(alice, DEMO_PROJECT);
    projectId = project.id;
    otherProjectId = (await projects.createProject(alice, { name: "Second project", description: "", context: "" })).id;
    bobProjectId = (await projects.createProject(bob, { name: "Bob project", description: "", context: "" })).id;

    const none = await view(vera, projectId);
    expect(none.lifecycle).toBeNull();
    expect(none.stages).toEqual([]);
    expect(none.progress).toBeNull();
    expect(none.facts).toEqual({ requirementsStatus: "none", blueprint: { exists: false, approved: false, approvedVersion: null }, deployment: { planExists: false, dryRunSucceeded: false, simulated: false }, artifactCount: 0 });
    const { rows } = await lifecycle.getPortfolio(alice);
    const row = rows.find((r) => r.project.id === projectId)!;
    expect(row.lifecycle).toBeNull();
    expect(row).toMatchObject({ openRisks: 0, highRisks: 0, nextMilestone: null, overdue: false });
    // Stage operations have nothing to act on yet.
    await expectError(lifecycle.startStage(alice, projectId, randomUUID()), "not_found");
    await expectError(lifecycle.updateLifecycle(alice, projectId, { status: "on_hold" }), "not_found");
  });

  it("initializes from the default template with stage and checklist snapshots, and nothing pre-completed", async () => {
    await expectError(lifecycle.initializeProjectLifecycle(vera, projectId), "forbidden");
    const before = await projects.getProject(alice, projectId);
    const started = await lifecycle.initializeProjectLifecycle(carol, projectId);
    expect(started.lifecycle).toMatchObject({ status: "active", templateName: DEFAULT_TEMPLATE_NAME, templateVersion: 1 });
    expect(started.lifecycle!.startedAt).not.toBeNull();
    expect(started.stages.map((s) => s.stageKey)).toEqual(DEFAULT_LIFECYCLE_TEMPLATE.stages.map((s) => s.stageKey));
    expect(started.stages.map((s) => s.status)).toEqual(["in_progress", "not_started", "not_started", "not_started", "not_started", "not_started", "not_started", "not_started"]);
    expect(started.stages[0]!.startAt).not.toBeNull();
    expect(started.stages.every((s) => s.owner === null && s.reviewer === null && s.dueAt === null && s.completedAt === null)).toBe(true);
    const items = started.stages.flatMap((s) => s.checklist);
    expect(items).toHaveLength(TOTAL_ITEMS);
    expect(items.every((i) => i.status === "pending" && i.origin === "template" && i.completedAt === null)).toBe(true);
    expect(started.stages[1]!.checklist.map((i) => i.title)).toEqual(DEFAULT_LIFECYCLE_TEMPLATE.stages[1]!.checklist.map((c) => c.title));
    expect(started.progress).toMatchObject({ percent: 0, requiredStages: 7, requiredStagesDone: 0, currentStageId: started.stages[0]!.id, checklist: { total: TOTAL_ITEMS, satisfied: 0 } });

    // Existing project data is untouched.
    const after = await projects.getProject(alice, projectId);
    expect({ ...after, updatedAt: null }).toEqual({ ...before, updatedAt: null });
    expect((await templates.listLifecycleTemplates(alice)).find((t) => t.builtIn)!.projectCount).toBe(1);
  });

  it("never gives a project a second lifecycle, even under concurrent requests", async () => {
    await expectError(lifecycle.initializeProjectLifecycle(alice, projectId), "conflict", /already has a lifecycle/);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => lifecycle.initializeProjectLifecycle(alice, otherProjectId)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect((r.reason as AppError).code).toBe("conflict");
    const rows = await getDb().select().from(schema.projectLifecycles).where(eq(schema.projectLifecycles.projectId, otherProjectId));
    expect(rows).toHaveLength(1);
    expect((await view(alice, otherProjectId)).stages).toHaveLength(8);
  });

  it("keeps a project's snapshots when its template is edited later", async () => {
    const [builtIn] = (await templates.listLifecycleTemplates(alice)).filter((t) => t.builtIn);
    const original = await templates.getLifecycleTemplate(alice, builtIn!.id);
    const edited = original.stages.slice(0, 3).map((s, i) => ({ ...s, name: `${s.name} (revised)`, requiresApproval: i !== 0, checklist: s.checklist.slice(0, 2).map((c) => ({ ...c, title: `${c.title} [v2]` })) }));
    await expectError(templates.updateLifecycleTemplate(alice, builtIn!.id, { name: original.name, description: original.description, stages: edited, expectedVersion: 7 }), "conflict", /changed since/);
    const updated = await templates.updateLifecycleTemplate(alice, builtIn!.id, { name: original.name, description: original.description, stages: edited, expectedVersion: 1 });
    expect(updated.version).toBe(2);
    expect(updated.stages).toHaveLength(3);

    const snapshot = await view(alice, projectId);
    expect(snapshot.lifecycle!.templateVersion).toBe(1);
    expect(snapshot.stages).toHaveLength(8);
    expect(snapshot.stages.map((s) => s.name)).toEqual(DEFAULT_LIFECYCLE_TEMPLATE.stages.map((s) => s.name));
    expect(snapshot.stages[0]!.requiresApproval).toBe(true);
    expect(snapshot.stages.flatMap((s) => s.checklist)).toHaveLength(TOTAL_ITEMS);
    expect(snapshot.stages.flatMap((s) => s.checklist).some((i) => i.title.includes("[v2]"))).toBe(false);

    // A lifecycle started now uses the edited version.
    const fresh = await projects.createProject(alice, { name: "Started after the edit", description: "", context: "" });
    const next = await lifecycle.initializeProjectLifecycle(alice, fresh.id);
    expect(next.lifecycle!.templateVersion).toBe(2);
    expect(next.stages.map((s) => s.name)).toEqual(["Initiate (revised)", "Discover (revised)", "Design (revised)"]);
    expect(next.stages[0]!.checklist).toHaveLength(2);

    // Put the built-in template back for the rest of the suite.
    await templates.updateLifecycleTemplate(alice, builtIn!.id, { name: original.name, description: original.description, stages: original.stages, expectedVersion: 2 });
  });

  it("assigns owners, reviewers and due dates to workspace members only", async () => {
    const stage = await stageOf(alice, projectId, "initiate");
    const updated = await lifecycle.updateStage(carol, projectId, stage.id, { ownerId: carol.userId, reviewerId: dave.userId, dueAt: new Date("2030-03-31T00:00:00Z"), notes: "Kick-off booked." });
    expect(updated.stages[0]).toMatchObject({ owner: { id: carol.userId, name: "Carol" }, reviewer: { id: dave.userId, name: "Dave" }, dueAt: "2030-03-31T00:00:00.000Z", notes: "Kick-off booked.", overdue: false });

    const outsider = await expectError(lifecycle.updateStage(alice, projectId, stage.id, { ownerId: bob.userId }), "validation_error", /not a member/);
    expect(outsider.fieldErrors?.ownerId).toBeDefined();
    await expectError(lifecycle.updateStage(alice, projectId, stage.id, { reviewerId: bob.userId }), "validation_error");
    await expectError(lifecycle.updateStage(alice, projectId, stage.id, { reviewerId: randomUUID() }), "validation_error");
    // A viewer of the same workspace cannot be the reviewer, because they could not decide the gate.
    await expectError(lifecycle.updateStage(alice, projectId, stage.id, { reviewerId: vera.userId }), "validation_error", /viewer/);
    const item = stage.checklist[0]!;
    await expectError(lifecycle.updateChecklistItem(alice, projectId, stage.id, item.id, { assigneeId: bob.userId }), "validation_error");
    await expectError(lifecycle.createChecklistItem(alice, projectId, stage.id, { title: "Extra item", description: "", itemType: "task", isRequired: false, assigneeId: bob.userId }), "validation_error");
    await expectError(lifecycle.createMilestone(alice, projectId, { name: "Go-live", description: "", status: "planned", ownerId: bob.userId, dueAt: null }), "validation_error");
    await expectError(lifecycle.createRisk(alice, projectId, { title: "Outsider owns this", description: "", category: "delivery", likelihood: 2, impact: 2, status: "open", ownerId: bob.userId, mitigation: "", dueAt: null }), "validation_error");
    await expectError(lifecycle.requestStageApproval(alice, projectId, stage.id, { reviewerId: bob.userId, note: "Please review." }), "validation_error");
    expect((await stageOf(alice, projectId, "initiate")).owner?.id).toBe(carol.userId);

    const past = await lifecycle.updateStage(alice, projectId, stage.id, { dueAt: new Date("2020-01-01T00:00:00Z") });
    expect(past.stages[0]!.overdue).toBe(true);
    expect(past.progress!.overdueStageIds).toEqual([stage.id]);
    await lifecycle.updateStage(alice, projectId, stage.id, { dueAt: new Date("2030-03-31T00:00:00Z") });
  });

  it("enforces stage order on the server", async () => {
    const all = await view(alice, projectId);
    const [initiate, discover, design] = all.stages;
    expect(discover!.start).toEqual({ allowed: false, reason: "Complete or skip “Initiate” first." });
    await expectError(lifecycle.startStage(alice, projectId, discover!.id), "precondition_failed", /Initiate/);
    await expectError(lifecycle.startStage(alice, projectId, design!.id), "precondition_failed");
    await expectError(lifecycle.updateStage(alice, projectId, discover!.id, { status: "in_progress" }), "precondition_failed");
    await expectError(lifecycle.skipStage(alice, projectId, design!.id, "Not needed."), "precondition_failed");
    await expectError(lifecycle.startStage(alice, projectId, initiate!.id), "precondition_failed", /already in progress/);
    // The optional stage cannot start before the project reaches Operate.
    await expectError(lifecycle.startStage(alice, projectId, all.stages[7]!.id), "precondition_failed", /Operate/);
    // Checklist work cannot start on a stage that has not started.
    await expectError(lifecycle.updateChecklistItem(alice, projectId, discover!.id, discover!.checklist[0]!.id, { status: "completed" }), "precondition_failed", /Start/);
    await expectError(lifecycle.requestStageApproval(alice, projectId, discover!.id, { reviewerId: dave.userId, note: "Too early." }), "precondition_failed");
  });

  it("blocks the gate while required checklist items are open, and reports the blockers", async () => {
    const stage = await stageOf(alice, projectId, "initiate");
    expect(stage.readiness.ready).toBe(false);
    expect(stage.readiness.blockers[0]).toMatchObject({ code: "required_checklist_incomplete", rule: "required_checklist_complete" });
    const error = await expectError(lifecycle.requestStageApproval(carol, projectId, stage.id, { note: "Please review." }), "precondition_failed", /5 required checklist items are still open/);
    const blockers = error.details?.blockers as Blocker[];
    expect(blockers).toHaveLength(1);
    expect(blockers[0]!.itemIds).toHaveLength(5);
    // A stage with an approval gate cannot be completed directly, and a client cannot assert a status.
    const direct = await expectError(lifecycle.completeStage(alice, projectId, stage.id), "precondition_failed");
    expect((direct.details?.blockers as Blocker[]).map((b) => b.code)).toEqual(["required_checklist_incomplete", "stage_approval_missing"]);
    await expectError(lifecycle.updateStage(alice, projectId, stage.id, { status: "completed" }), "precondition_failed");
    expect((await stageOf(alice, projectId, "initiate")).status).toBe("in_progress");
  });

  it("records who completed and reopened checklist items, and requires a reason to waive", async () => {
    const stage = await stageOf(alice, projectId, "initiate");
    const [first, second, third] = stage.checklist;
    const done = await lifecycle.updateChecklistItem(carol, projectId, stage.id, first!.id, { status: "completed", notes: "Charter v1 agreed." });
    expect(done.status).toBe("completed");
    let item = (await stageOf(alice, projectId, "initiate")).checklist[0]!;
    expect(item).toMatchObject({ status: "completed", completedBy: { id: carol.userId }, statusChangedBy: { id: carol.userId }, notes: "Charter v1 agreed." });
    expect(item.completedAt).not.toBeNull();

    await lifecycle.updateChecklistItem(alice, projectId, stage.id, first!.id, { status: "in_progress" });
    item = (await stageOf(alice, projectId, "initiate")).checklist[0]!;
    expect(item).toMatchObject({ status: "in_progress", completedAt: null, completedBy: null, statusChangedBy: { id: alice.userId } });

    await expectError(lifecycle.waiveChecklistItem(vera, projectId, stage.id, second!.id, "Viewer waiver."), "forbidden");
    const noReason = await expectError(lifecycle.waiveChecklistItem(carol, projectId, stage.id, second!.id, "   "), "validation_error");
    expect(noReason.fieldErrors?.reason).toBeDefined();
    expect((await stageOf(alice, projectId, "initiate")).checklist[1]!.status).toBe("pending");
    await lifecycle.waiveChecklistItem(carol, projectId, stage.id, second!.id, "Sponsor is already named in the programme charter.");
    const waived = (await stageOf(alice, projectId, "initiate")).checklist[1]!;
    expect(waived).toMatchObject({ status: "waived", waivedReason: "Sponsor is already named in the programme charter.", isRequired: true, completedAt: null });
    await expectError(lifecycle.waiveChecklistItem(carol, projectId, stage.id, second!.id, "Again."), "precondition_failed");

    const events = await recentActivity(alice, { projectId, actionPrefix: "lifecycle.checklist", limit: 20 });
    expect(events.map((e) => e.action)).toEqual(["lifecycle.checklist.waive", "lifecycle.checklist.reopen", "lifecycle.checklist.complete"]);
    const [waiver] = await getDb().select().from(schema.auditEvents).where(and(eq(schema.auditEvents.action, "lifecycle.checklist.waive"), eq(schema.auditEvents.projectId, projectId)));
    expect(waiver).toMatchObject({ actorId: carol.userId, entityType: "checklist_item", entityId: second!.id });
    // The reason is in the trail (it must outlive the waiver); metadata holds IDs and state changes only.
    expect(waiver!.summary).toContain("reason: Sponsor is already named in the programme charter.");
    expect(waiver!.metadata).toMatchObject({ required: true, from: "pending", to: "waived", stageId: stage.id, itemId: second!.id });
    expect(waiver!.metadata).not.toHaveProperty("reason");

    // Required and template items cannot be deleted; only optional items added to the project can.
    await expectError(lifecycle.deleteChecklistItem(alice, projectId, stage.id, third!.id), "precondition_failed", /Waive/);
    const required = await lifecycle.createChecklistItem(carol, projectId, stage.id, { title: "Confirm funding code", description: "", itemType: "task", isRequired: true });
    await expectError(lifecycle.deleteChecklistItem(alice, projectId, stage.id, required.id), "precondition_failed");
    const optional = await lifecycle.createChecklistItem(carol, projectId, stage.id, { title: "Share kick-off deck", description: "", itemType: "deliverable", isRequired: false });
    await lifecycle.deleteChecklistItem(carol, projectId, stage.id, optional.id);
    const after = await stageOf(alice, projectId, "initiate");
    expect(after.checklist).toHaveLength(6);
    expect(after.checklist[5]).toMatchObject({ title: "Confirm funding code", origin: "custom", isRequired: true });
    // The waived item counts towards the gate; the three open template items and the new required item do not.
    expect(after.readiness.blockers[0]!.itemIds).toHaveLength(5);
  });

  it("runs the approval gate: request, wrong reviewer, reject, re-request, withdraw, approve — with history kept", async () => {
    const stage = await completeChecklist(alice, projectId, "initiate");
    expect((await stageOf(alice, projectId, "initiate")).readiness).toMatchObject({ ready: true, blockers: [] });
    await expectError(lifecycle.requestStageApproval(vera, projectId, stage.id, { note: "Viewer request." }), "forbidden");

    // Dave is the stage's assigned reviewer, so no reviewer has to be named.
    const first = await lifecycle.requestStageApproval(carol, projectId, stage.id, { note: "Initiate is ready for review." });
    expect((await stageOf(alice, projectId, "initiate")).status).toBe("pending_approval");
    await expectError(lifecycle.requestStageApproval(carol, projectId, stage.id, { note: "Second request." }), "precondition_failed");
    // The checklist is frozen while the gate is under review.
    await expectError(lifecycle.updateChecklistItem(alice, projectId, stage.id, stage.checklist[0]!.id, { status: "pending" }), "precondition_failed", /Withdraw/);
    await expectError(lifecycle.addStageEvidence(alice, projectId, stage.id, { evidenceType: "note", title: "Late note", note: "x" }), "precondition_failed");

    // Carol requested it and is an editor, but she is not the reviewer.
    await expectError(lifecycle.decideStageApproval(carol, projectId, stage.id, first.id, "approve", ""), "forbidden", /assigned reviewer/);
    await expectError(lifecycle.decideStageApproval(carol, projectId, stage.id, first.id, "reject", "No."), "forbidden");
    await expectError(lifecycle.decideStageApproval(vera, projectId, stage.id, first.id, "approve", ""), "forbidden");
    await expectError(lifecycle.decideStageApproval(vera, projectId, stage.id, first.id, "withdraw", ""), "forbidden");
    await expectError(lifecycle.decideStageApproval(dave, projectId, stage.id, first.id, "withdraw", ""), "forbidden", /requested/);
    await expectError(lifecycle.decideStageApproval(dave, projectId, stage.id, first.id, "reject", "  "), "validation_error");

    const rejected = await lifecycle.decideStageApproval(dave, projectId, stage.id, first.id, "reject", "Success measures are not quantified.");
    expect(rejected).toMatchObject({ status: "rejected", stageStatus: "in_progress" });
    let current = await stageOf(alice, projectId, "initiate");
    expect(current.status).toBe("in_progress");
    expect(current.approvals[0]).toMatchObject({ status: "rejected", decisionNote: "Success measures are not quantified.", decidedBy: { id: dave.userId }, reviewer: { id: dave.userId }, requestedBy: { id: carol.userId } });
    await expectError(lifecycle.decideStageApproval(dave, projectId, stage.id, first.id, "approve", ""), "precondition_failed", /already rejected/);

    const second = await lifecycle.requestStageApproval(carol, projectId, stage.id, { note: "Measures quantified." });
    expect(second.id).not.toBe(first.id);
    await lifecycle.decideStageApproval(carol, projectId, stage.id, second.id, "withdraw", "One more change to make.");
    expect((await stageOf(alice, projectId, "initiate")).status).toBe("in_progress");

    // If a condition stops holding while the request is open, the reviewer cannot approve.
    const third = await lifecycle.requestStageApproval(carol, projectId, stage.id, { note: "Final." });
    await getDb().update(schema.projectChecklistItems).set({ status: "pending" }).where(eq(schema.projectChecklistItems.id, stage.checklist[2]!.id));
    const stale = await expectError(lifecycle.decideStageApproval(dave, projectId, stage.id, third.id, "approve", ""), "precondition_failed", /cannot be approved yet/);
    expect((stale.details?.blockers as Blocker[])[0]!.code).toBe("required_checklist_incomplete");
    await getDb().update(schema.projectChecklistItems).set({ status: "completed" }).where(eq(schema.projectChecklistItems.id, stage.checklist[2]!.id));

    const approved = await lifecycle.decideStageApproval(dave, projectId, stage.id, third.id, "approve", "Good to go.");
    expect(approved).toMatchObject({ status: "approved", stageStatus: "completed" });
    current = await stageOf(alice, projectId, "initiate");
    expect(current.status).toBe("completed");
    expect(current.completedAt).not.toBeNull();
    expect(current.approvals.map((a) => a.status)).toEqual(["approved", "withdrawn", "rejected"]);
    expect(current.approvals.every((a) => a.invalidated === null)).toBe(true);
    const all = await view(alice, projectId);
    expect(all.progress).toMatchObject({ percent: 14, requiredStagesDone: 1, currentStageId: all.stages[1]!.id });
    // A closed stage is frozen until it is reopened.
    await expectError(lifecycle.updateChecklistItem(alice, projectId, stage.id, stage.checklist[0]!.id, { status: "pending" }), "precondition_failed", /Reopen/);
    await expectError(lifecycle.blockStage(alice, projectId, stage.id, "Too late."), "precondition_failed");
  });

  it("lets a workspace owner decide any gate, and blocks and resumes a stage with a reason", async () => {
    const discover = await stageOf(alice, projectId, "discover");
    await lifecycle.startStage(carol, projectId, discover.id);
    const noReason = await expectError(lifecycle.blockStage(carol, projectId, discover.id, " "), "validation_error");
    expect(noReason.fieldErrors?.reason).toBeDefined();
    await lifecycle.blockStage(carol, projectId, discover.id, "Waiting for access to the ERP source.");
    let current = await stageOf(alice, projectId, "discover");
    expect(current).toMatchObject({ status: "blocked", blockedReason: "Waiting for access to the ERP source." });
    expect((await view(alice, projectId)).progress).toMatchObject({ blockedStageIds: [discover.id], currentStageId: discover.id });
    await expectError(lifecycle.requestStageApproval(carol, projectId, discover.id, { reviewerId: dave.userId, note: "Blocked." }), "precondition_failed");
    await lifecycle.startStage(carol, projectId, discover.id);
    current = await stageOf(alice, projectId, "discover");
    expect(current).toMatchObject({ status: "in_progress", blockedReason: null });
  });

  it("holds Discover until the requirements are approved in DataBrain", async () => {
    const stage = await completeChecklist(alice, projectId, "discover");
    let current = await stageOf(alice, projectId, "discover");
    expect(current.readiness.blockers).toEqual([expect.objectContaining({ code: "requirements_not_started", path: "/requirements" })]);
    await projects.extractRequirements(alice, projectId);
    current = await stageOf(alice, projectId, "discover");
    expect(current.readiness.blockers[0]).toMatchObject({ code: "requirements_not_approved", message: "Approve the project requirements before completing Discover." });
    const error = await expectError(lifecycle.requestStageApproval(carol, projectId, stage.id, { reviewerId: dave.userId, note: "Discover done." }), "precondition_failed", /Approve the project requirements/);
    expect((error.details?.blockers as Blocker[]).map((b) => b.code)).toEqual(["requirements_not_approved"]);

    await projects.approveRequirements(alice, projectId);
    expect((await stageOf(alice, projectId, "discover")).readiness.ready).toBe(true);
    // The owner decides this one although Dave is the named reviewer.
    const approval = await lifecycle.requestStageApproval(carol, projectId, stage.id, { reviewerId: dave.userId, note: "Discover done." });
    await lifecycle.decideStageApproval(alice, projectId, stage.id, approval.id, "approve", "");
    expect((await stageOf(alice, projectId, "discover")).status).toBe("completed");
  });

  it("holds Design until a blueprint is approved, reporting a missing blueprint as missing", async () => {
    const design = await stageOf(alice, projectId, "design");
    await lifecycle.startStage(alice, projectId, design.id);
    await completeChecklist(alice, projectId, "design");
    expect((await stageOf(alice, projectId, "design")).readiness.blockers).toEqual([expect.objectContaining({ code: "blueprint_missing", path: "/blueprint" })]);

    const { candidates } = await finder.runFinder(alice, projectId);
    const revision = await blueprint.createRevisionFromCandidate(alice, projectId, candidates[0]!.id);
    expect((await stageOf(alice, projectId, "design")).readiness.blockers[0]).toMatchObject({ code: "blueprint_not_approved" });
    await expectError(lifecycle.requestStageApproval(carol, projectId, design.id, { reviewerId: dave.userId, note: "Design done." }), "precondition_failed", /Approve the Solution Blueprint/);

    await blueprint.approveRevision(alice, projectId, revision.id, { lockVersion: 1, note: "Reviewed." });
    const ready = await view(alice, projectId);
    expect(ready.facts.blueprint).toEqual({ exists: true, approved: true, approvedVersion: 1 });
    expect(ready.stages[2]!.readiness.ready).toBe(true);

    // The project list and the Mission Control KPI read the same records.
    const listed = (await projects.listProjects(alice)).find((r) => r.project.id === projectId)!;
    expect(listed.requirementCount).toBeGreaterThan(5);
    expect(listed).toMatchObject({ revisionCount: 1, approvedVersion: 1 });
    expect(await projectStats(alice)).toMatchObject({ approved: 1 });
  });

  it("links evidence only to this project's artifacts, safe URLs and notes; evidence is superseded, never edited", async () => {
    const design = await stageOf(alice, projectId, "design");
    const job = await artifacts.generateArtifacts(alice, projectId, { revisionId: (await blueprint.getApprovedRevision(alice, projectId))!.id, types: ARTIFACT_DEFS.map((d) => d.type), idempotencyKey: "lifecycle-gen-1" }, { wait: true });
    expect((await getJob(alice, job.id)).status).toBe("succeeded");
    const list = await artifacts.listArtifacts(alice, projectId);
    const hld = list.find((a) => a.artifact.type === "hld")!;

    const linked = await lifecycle.addStageEvidence(carol, projectId, design.id, { evidenceType: "artifact", title: "High-level design", artifactId: hld.artifact.id, checklistItemId: design.checklist[1]!.id });
    const url = await lifecycle.addStageEvidence(carol, projectId, design.id, { evidenceType: "url", title: "Design review minutes", url: "https://example.com/reviews/42" });
    await lifecycle.addStageEvidence(carol, projectId, design.id, { evidenceType: "note", title: "Security review outcome", note: "Reviewed with the security architect; no open findings." });
    let evidence = await lifecycle.listStageEvidence(vera, projectId, design.id);
    expect(evidence).toHaveLength(3);
    const artifactEvidence = evidence.find((e) => e.id === linked.id)!;
    expect(artifactEvidence).toMatchObject({ evidenceType: "artifact", artifact: { id: hld.artifact.id, path: "docs/hld.md", version: 1 }, checklistItemId: design.checklist[1]!.id, createdBy: { id: carol.userId }, superseded: null });
    expect((await stageOf(alice, projectId, "design")).checklist[1]!.evidenceCount).toBe(1);

    // Unsafe or malformed references never reach storage.
    for (const bad of ["javascript:alert(document.cookie)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "https://user:pw@example.com/x"]) {
      expect(evidenceCreateSchema.safeParse({ evidenceType: "url", title: "Bad link", url: bad }).success, bad).toBe(false);
      await expectError(lifecycle.addStageEvidence(carol, projectId, design.id, { evidenceType: "url", title: "Bad link", url: bad }), "validation_error");
    }
    // An artifact of another project, a revision of another artifact, or a checklist item of another stage is not found.
    const foreign = await projects.createProject(alice, { name: "Evidence from elsewhere", description: "", context: "" });
    await lifecycle.initializeProjectLifecycle(alice, foreign.id);
    const foreignStage = await stageOf(alice, foreign.id, "initiate");
    await expectError(lifecycle.addStageEvidence(alice, foreign.id, foreignStage.id, { evidenceType: "artifact", title: "Borrowed HLD", artifactId: hld.artifact.id }), "not_found");
    const runbook = list.find((a) => a.artifact.type === "runbook")!;
    await expectError(lifecycle.addStageEvidence(alice, projectId, design.id, { evidenceType: "artifact", title: "Mismatched", artifactId: hld.artifact.id, artifactRevisionId: runbook.latest!.id }), "not_found");
    await expectError(lifecycle.addStageEvidence(alice, projectId, design.id, { evidenceType: "note", title: "Wrong item", note: "x", checklistItemId: foreignStage.checklist[0]!.id }), "not_found");
    await expectError(lifecycle.addStageEvidence(alice, projectId, design.id, { evidenceType: "artifact", title: "Missing", artifactId: randomUUID() }), "not_found");
    await expectError(lifecycle.addStageEvidence(vera, projectId, design.id, { evidenceType: "note", title: "Viewer note", note: "x" }), "forbidden");

    await lifecycle.supersedeStageEvidence(alice, projectId, design.id, url.id, "Linked the wrong meeting.");
    await expectError(lifecycle.supersedeStageEvidence(alice, projectId, design.id, url.id, "Again."), "precondition_failed");
    evidence = await lifecycle.listStageEvidence(alice, projectId, design.id);
    expect(evidence).toHaveLength(3);
    expect(evidence.find((e) => e.id === url.id)!.superseded).toMatchObject({ reason: "Linked the wrong meeting.", by: { id: alice.userId } });
    expect(evidence.find((e) => e.id === url.id)!.url).toBe("https://example.com/reviews/42");
    // A linked artifact cannot be removed from under its evidence.
    await expect(getDb().delete(schema.artifacts).where(eq(schema.artifacts.id, hld.artifact.id))).rejects.toThrow();
  });

  it("holds Release until the current deployment plan has a successful dry-run", async () => {
    await passGate(projectId, "design");
    await runStage(projectId, "build");
    await runStage(projectId, "validate");
    const release = await stageOf(alice, projectId, "release");
    await lifecycle.startStage(alice, projectId, release.id);
    await completeChecklist(alice, projectId, "release");
    expect((await stageOf(alice, projectId, "release")).readiness.blockers).toEqual([expect.objectContaining({ code: "deployment_plan_missing", path: "/deployments" })]);

    const environment = await projects.createEnvironment(alice, projectId, { name: "prod-eu", kind: "production", platform: "Microsoft Fabric", notes: "" });
    const [manifest] = await artifacts.listManifests(alice, projectId);
    const plan = await deployments.createPlan(alice, projectId, { environmentId: environment.id, manifestId: manifest!.id });
    expect((await stageOf(alice, projectId, "release")).readiness.blockers[0]).toMatchObject({ code: "deployment_dry_run_missing" });
    await expectError(lifecycle.requestStageApproval(carol, projectId, release.id, { reviewerId: dave.userId, note: "Release." }), "precondition_failed", /dry-run/);

    await deployments.startRun(alice, projectId, plan.id, { mode: "dry-run" }, { wait: true });
    const ready = await view(alice, projectId);
    // The only adapter is a simulator, and the lifecycle says so.
    expect(ready.facts.deployment).toEqual({ planExists: true, dryRunSucceeded: true, simulated: true });
    expect(ready.stages[5]!.readiness.ready).toBe(true);

    // A new plan supersedes the old one, and its dry-run has not happened yet.
    const next = await deployments.createPlan(alice, projectId, { environmentId: environment.id, manifestId: manifest!.id });
    expect((await stageOf(alice, projectId, "release")).readiness.blockers[0]).toMatchObject({ code: "deployment_dry_run_missing" });
    await deployments.startRun(alice, projectId, next.id, { mode: "dry-run" }, { wait: true });
    await passGate(projectId, "release");
    expect((await view(alice, projectId)).progress).toMatchObject({ percent: 86, requiredStagesDone: 6 });
  });

  it("lets Improve & Retire start from Operate without holding Operate back", async () => {
    const all = await view(alice, projectId);
    const operate = all.stages[6]!;
    const improve = all.stages[7]!;
    await expectError(lifecycle.startStage(alice, projectId, improve.id), "precondition_failed");
    await lifecycle.startStage(alice, projectId, operate.id);
    await lifecycle.startStage(alice, projectId, improve.id);
    let current = await view(alice, projectId);
    expect(current.stages.slice(6).map((s) => s.status)).toEqual(["in_progress", "in_progress"]);
    // Operate is still the current stage and progress is unchanged by the optional stage.
    expect(current.progress).toMatchObject({ percent: 86, currentStageId: operate.id });
    await expectError(lifecycle.updateLifecycle(alice, projectId, { status: "completed" }), "precondition_failed", /Operate/);

    await passGate(projectId, "operate");
    current = await view(alice, projectId);
    expect(current.progress).toMatchObject({ percent: 100, requiredStagesDone: 7, currentStageId: improve.id });
    expect(current.lifecycle!.status).toBe("active");
    // The optional stage never holds Operate back, but the lifecycle cannot be closed over a stage that is under way.
    await expectError(lifecycle.updateLifecycle(alice, projectId, { status: "completed" }), "precondition_failed", /Finish or skip “Improve & Retire”/);
    // An editor may skip the optional stage; only an owner may skip a required one.
    await lifecycle.skipStage(carol, projectId, improve.id, "No retirement planned this year.");
    expect((await stageOf(alice, projectId, "improve_retire"))).toMatchObject({ status: "skipped", skipReason: "No retirement planned this year." });
    const done = await lifecycle.updateLifecycle(carol, projectId, { status: "completed", note: "Handed over to operations." });
    expect(done.lifecycle).toMatchObject({ status: "completed" });
    expect(done.lifecycle!.completedAt).not.toBeNull();
    await expectError(lifecycle.updateStage(alice, projectId, operate.id, { notes: "After completion." }), "precondition_failed", /completed/);
  });

  it("reopens a stage with a reason: its approval is voided and later stages are held for review, with their work kept", async () => {
    const before = await view(alice, projectId);
    const [initiate, discover, design] = before.stages;
    await expectError(lifecycle.reopenStage(vera, projectId, discover!.id, "Viewer reopen."), "forbidden");
    const noReason = await expectError(lifecycle.reopenStage(alice, projectId, discover!.id, ""), "validation_error");
    expect(noReason.fieldErrors?.reason).toBeDefined();
    await expectError(lifecycle.reopenStage(alice, projectId, before.stages[7]!.id.replace(/.$/, "0"), "No such stage."), "not_found");

    const after = await lifecycle.reopenStage(carol, projectId, discover!.id, "Two KPI definitions changed after UAT.");
    expect(after.lifecycle!.status).toBe("active");
    expect(after.stages.map((s) => s.status)).toEqual(["completed", "in_progress", "blocked", "blocked", "blocked", "blocked", "blocked", "skipped"]);
    const reopened = after.stages[1]!;
    expect(reopened.completedAt).toBeNull();
    expect(reopened.approvals[0]).toMatchObject({ status: "approved", invalidated: { reason: "Stage reopened: Two KPI definitions changed after UAT." } });
    // Earlier stages are untouched.
    expect(after.stages[0]!.approvals[0]!.invalidated).toBeNull();
    expect(after.stages[0]!.completedAt).toBe(initiate!.completedAt);

    const held = after.stages[2]!;
    expect(held.blockedReason).toMatch(/^Earlier stage “Discover” was reopened: Two KPI definitions changed after UAT\. Review this stage once “Discover” is completed again\.$/);
    expect(held.completedAt).toBeNull();
    expect(held.approvals[0]!.invalidated?.reason).toMatch(/Discover/);
    // Nothing downstream was deleted.
    expect(held.checklist.map((i) => i.status)).toEqual(design!.checklist.map((i) => i.status));
    expect(held.evidence).toHaveLength(3);
    expect(after.progress).toMatchObject({ percent: 14, requiredStagesDone: 1, currentStageId: discover!.id });
    expect(after.progress!.blockedStageIds).toHaveLength(5);

    // Held stages cannot resume or be approved until the reopened stage is completed again.
    await expectError(lifecycle.startStage(alice, projectId, held.id), "precondition_failed", /Discover/);
    await expectError(lifecycle.completeStage(alice, projectId, held.id), "precondition_failed");
    await expectError(lifecycle.requestStageApproval(alice, projectId, held.id, { reviewerId: dave.userId, note: "Skip the review." }), "precondition_failed");

    // The reopened stage needs a new approval: the voided one does not count.
    expect((await expectError(lifecycle.completeStage(alice, projectId, discover!.id), "precondition_failed")).details?.blockers).toEqual([expect.objectContaining({ code: "stage_approval_missing" })]);
    await passGate(projectId, "discover");
    await lifecycle.startStage(alice, projectId, held.id);
    const resumed = await stageOf(alice, projectId, "design");
    expect(resumed).toMatchObject({ status: "in_progress", blockedReason: null });
    expect(resumed.approvals.filter((a) => a.status === "approved" && !a.invalidated)).toHaveLength(0);
    await passGate(projectId, "design");
    expect((await stageOf(alice, projectId, "design")).approvals.map((a) => [a.status, a.invalidated !== null])).toEqual([["approved", false], ["approved", true]]);

    const events = await recentActivity(alice, { projectId, actionPrefix: "lifecycle.stage.reopen" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: "Carol", summary: "Reopened stage “Discover”: Two KPI definitions changed after UAT." });
  });

  it("withdraws a pending request downstream when an earlier stage is reopened, and restricts skipping required stages to owners", async () => {
    const all = await view(alice, projectId);
    const build = all.stages[3]!;
    await lifecycle.startStage(alice, projectId, build.id);
    const pending = await lifecycle.requestStageApproval(carol, projectId, build.id, { reviewerId: dave.userId, note: "Build again." });
    const after = await lifecycle.reopenStage(alice, projectId, all.stages[2]!.id, "Network design changed.");
    const held = after.stages[3]!;
    expect(held.status).toBe("blocked");
    expect(held.approvals.find((a) => a.id === pending.id)).toMatchObject({ status: "withdrawn" });
    expect(held.approvals.find((a) => a.id === pending.id)!.decisionNote).toMatch(/^Withdrawn automatically\. Earlier stage “Design” was reopened/);
    await expectError(lifecycle.decideStageApproval(dave, projectId, build.id, pending.id, "approve", ""), "precondition_failed");

    await expectError(lifecycle.skipStage(carol, projectId, all.stages[2]!.id, "Skip design."), "forbidden", /owner/);
    await expectError(lifecycle.skipStage(alice, projectId, all.stages[2]!.id, " "), "validation_error");
    const skipped = await lifecycle.skipStage(alice, projectId, all.stages[2]!.id, "Design is inherited from the programme baseline.");
    expect(skipped.stages[2]).toMatchObject({ status: "skipped", skipReason: "Design is inherited from the programme baseline." });
    // A skipped required stage counts as done for ordering and progress.
    expect(skipped.progress).toMatchObject({ requiredStagesDone: 3, skippedStages: 2 });
    await lifecycle.startStage(alice, projectId, build.id);
    expect((await stageOf(alice, projectId, "build")).status).toBe("in_progress");
  });

  it("manages milestones with owners, due dates and overdue state", async () => {
    await expectError(lifecycle.createMilestone(vera, projectId, { name: "Viewer milestone", description: "", status: "planned", ownerId: null, dueAt: null }), "forbidden");
    const past = await lifecycle.createMilestone(carol, projectId, { name: "UAT sign-off", description: "Business sign-off", status: "planned", ownerId: dave.userId, dueAt: new Date("2021-05-01T00:00:00Z") });
    const future = await lifecycle.createMilestone(carol, projectId, { name: "Go-live", description: "", status: "planned", ownerId: null, dueAt: new Date("2031-01-15T00:00:00Z") });
    const undated = await lifecycle.createMilestone(carol, projectId, { name: "Hypercare review", description: "", status: "planned", ownerId: null, dueAt: null });

    let list = await lifecycle.listMilestones(vera, projectId);
    expect(list.map((m) => m.name)).toEqual(["UAT sign-off", "Go-live", "Hypercare review"]);
    expect(list.map((m) => m.overdue)).toEqual([true, false, false]);
    expect(list[0]).toMatchObject({ owner: { id: dave.userId, name: "Dave" }, dueAt: "2021-05-01T00:00:00.000Z", status: "planned", completedAt: null });
    // Overdue is relative to the server's date, which the tests can fix.
    expect((await lifecycle.listMilestones(alice, projectId, new Date("2021-04-30T12:00:00Z")))[0]!.overdue).toBe(false);
    expect((await lifecycle.listMilestones(alice, projectId, new Date("2031-02-01T00:00:00Z"))).map((m) => m.overdue)).toEqual([true, true, false]);

    let portfolio = (await lifecycle.getPortfolio(alice)).rows.find((r) => r.project.id === projectId)!;
    expect(portfolio).toMatchObject({ nextMilestone: { id: past.id, name: "UAT sign-off", overdue: true }, overdueMilestones: 1, overdue: true });

    await lifecycle.updateMilestone(carol, projectId, past.id, { status: "at_risk" });
    expect((await lifecycle.listMilestones(alice, projectId))[0]).toMatchObject({ status: "at_risk", overdue: true });
    const completed = await lifecycle.updateMilestone(carol, projectId, past.id, { status: "completed" });
    expect(completed.status).toBe("completed");
    list = await lifecycle.listMilestones(alice, projectId);
    expect(list[0]).toMatchObject({ status: "completed", overdue: false });
    expect(list[0]!.completedAt).not.toBeNull();
    await lifecycle.updateMilestone(carol, projectId, future.id, { name: "Production go-live", dueAt: new Date("2031-02-01T00:00:00Z"), ownerId: carol.userId });
    await lifecycle.updateMilestone(carol, projectId, undated.id, { status: "cancelled" });
    portfolio = (await lifecycle.getPortfolio(alice)).rows.find((r) => r.project.id === projectId)!;
    expect(portfolio).toMatchObject({ nextMilestone: { name: "Production go-live", dueAt: "2031-02-01T00:00:00.000Z", overdue: false }, overdueMilestones: 0 });

    await expectError(lifecycle.deleteMilestone(vera, projectId, undated.id), "forbidden");
    await lifecycle.deleteMilestone(carol, projectId, undated.id);
    expect(await lifecycle.listMilestones(alice, projectId)).toHaveLength(2);
    const actions = (await recentActivity(alice, { projectId, actionPrefix: "lifecycle.milestone", limit: 20 })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["lifecycle.milestone.create", "lifecycle.milestone.update", "lifecycle.milestone.complete", "lifecycle.milestone.cancel", "lifecycle.milestone.delete"]));
  });

  it("keeps a risk register with a server-side score", async () => {
    await expectError(lifecycle.createRisk(vera, projectId, { title: "Viewer risk", description: "", category: "delivery", likelihood: 1, impact: 1, status: "open", ownerId: null, mitigation: "", dueAt: null }), "forbidden");
    const high = await lifecycle.createRisk(carol, projectId, riskCreateSchema.parse({ title: "ERP extract window may be cut", category: "data", likelihood: 4, impact: 5, ownerId: dave.userId, dueAt: "2021-02-01" }));
    expect(high).toMatchObject({ score: 20, level: "critical", status: "open", category: "data", overdue: true, owner: { name: "Dave" } });
    const medium = await lifecycle.createRisk(carol, projectId, riskCreateSchema.parse({ title: "Key engineer on leave", likelihood: 3, impact: 3 }));
    expect(medium).toMatchObject({ score: 9, level: "medium" });
    await lifecycle.createRisk(carol, projectId, riskCreateSchema.parse({ title: "Licence renewal", category: "vendor", likelihood: 1, impact: 2 }));

    // The score is derived: a client value is rejected at the boundary and out-of-range inputs never reach a row.
    expect(riskCreateSchema.safeParse({ title: "Forged severity", likelihood: 1, impact: 1, severity: 25 }).success).toBe(false);
    await expect(lifecycle.createRisk(carol, projectId, { title: "Out of range", description: "", category: "other", likelihood: 9, impact: 1, status: "open", ownerId: null, mitigation: "", dueAt: null })).rejects.toThrow(RangeError);
    await expect(getDb().insert(schema.projectRisks).values({ workspaceId: alice.workspaceId, projectId, title: "Bypass", likelihood: 0, impact: 9, createdBy: alice.userId })).rejects.toThrow();

    let list = await lifecycle.listRisks(vera, projectId);
    expect(list.map((r) => r.score)).toEqual([20, 9, 2]);
    let portfolio = (await lifecycle.getPortfolio(alice)).rows.find((r) => r.project.id === projectId)!;
    expect(portfolio).toMatchObject({ openRisks: 3, highRisks: 1 });

    const rescored = await lifecycle.updateRisk(carol, projectId, medium.id, { likelihood: 4 });
    expect(rescored).toMatchObject({ score: 12, level: "high" });
    const mitigating = await lifecycle.updateRisk(carol, projectId, high.id, { status: "mitigating", mitigation: "Agree a fixed nightly window with the ERP team." });
    expect(mitigating).toMatchObject({ status: "mitigating", resolvedAt: null, score: 20 });
    portfolio = (await lifecycle.getPortfolio(alice)).rows.find((r) => r.project.id === projectId)!;
    expect(portfolio).toMatchObject({ openRisks: 3, highRisks: 2 });

    const accepted = await lifecycle.updateRisk(carol, projectId, medium.id, { status: "accepted" });
    expect(accepted).toMatchObject({ status: "accepted", resolvedAt: null });
    const resolved = await lifecycle.resolveRisk(carol, projectId, high.id);
    expect(resolved).toMatchObject({ status: "resolved", overdue: false });
    expect(resolved.resolvedAt).not.toBeNull();
    const closed = await lifecycle.updateRisk(alice, projectId, high.id, { status: "closed" });
    expect(closed.status).toBe("closed");
    const reopened = await lifecycle.updateRisk(alice, projectId, high.id, { status: "open" });
    expect(reopened).toMatchObject({ status: "open", resolvedAt: null, overdue: true });
    list = await lifecycle.listRisks(alice, projectId);
    expect(list.map((r) => [r.title, r.status])).toEqual([["ERP extract window may be cut", "open"], ["Key engineer on leave", "accepted"], ["Licence renewal", "open"]]);
    portfolio = (await lifecycle.getPortfolio(alice)).rows.find((r) => r.project.id === projectId)!;
    expect(portfolio).toMatchObject({ openRisks: 2, highRisks: 1 });

    const actions = (await recentActivity(alice, { projectId, actionPrefix: "lifecycle.risk", limit: 30 })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["lifecycle.risk.create", "lifecycle.risk.update", "lifecycle.risk.mitigation", "lifecycle.risk.accept", "lifecycle.risk.resolve", "lifecycle.risk.close"]));
  });

  it("gives viewers read access and nothing else", async () => {
    const all = await view(vera, projectId);
    expect(all.stages).toHaveLength(8);
    const stage = all.stages.find((s) => s.status === "in_progress")!;
    const item = stage.checklist[0]!;
    const [milestone] = await lifecycle.listMilestones(vera, projectId);
    const [risk] = await lifecycle.listRisks(vera, projectId);
    expect((await lifecycle.listMembers(vera)).map((m) => m.name)).toEqual(["Alice", "Carol", "Dave", "Vera"]);
    expect(await lifecycle.stageActivity(vera, projectId, stage.id)).not.toHaveLength(0);
    const [template] = await templates.listLifecycleTemplates(vera);
    const detail = await templates.getLifecycleTemplate(vera, template!.id);
    const denied: (() => Promise<unknown>)[] = [
      () => lifecycle.updateLifecycle(vera, projectId, { status: "on_hold" }),
      () => lifecycle.updateStage(vera, projectId, stage.id, { notes: "x" }),
      () => lifecycle.startStage(vera, projectId, stage.id),
      () => lifecycle.blockStage(vera, projectId, stage.id, "x"),
      () => lifecycle.completeStage(vera, projectId, stage.id),
      () => lifecycle.skipStage(vera, projectId, stage.id, "x"),
      () => lifecycle.reopenStage(vera, projectId, all.stages[0]!.id, "x"),
      () => lifecycle.createChecklistItem(vera, projectId, stage.id, { title: "Viewer item", description: "", itemType: "task", isRequired: false }),
      () => lifecycle.updateChecklistItem(vera, projectId, stage.id, item.id, { status: "completed" }),
      () => lifecycle.deleteChecklistItem(vera, projectId, stage.id, item.id),
      () => lifecycle.supersedeStageEvidence(vera, projectId, stage.id, randomUUID(), "x"),
      () => lifecycle.updateMilestone(vera, projectId, milestone!.id, { status: "completed" }),
      () => lifecycle.updateRisk(vera, projectId, risk!.id, { status: "closed" }),
      () => lifecycle.resolveRisk(vera, projectId, risk!.id),
      () => templates.updateLifecycleTemplate(vera, template!.id, { name: detail.name, description: "", stages: detail.stages, expectedVersion: detail.version }),
      () => templates.setDefaultLifecycleTemplate(vera, template!.id),
      () => templates.setLifecycleTemplateActive(vera, template!.id, false),
    ];
    for (const [index, call] of denied.entries()) {
      const error = await call().then(() => null, (e: unknown) => e);
      expect(error, `call ${index} should be forbidden`).toBeInstanceOf(AppError);
      expect((error as AppError).code, `call ${index}`).toBe("forbidden");
    }
    expect((await view(alice, projectId)).stages.map((s) => s.status)).toEqual(all.stages.map((s) => s.status));
  });

  it("denies every cross-workspace read and write as not found", async () => {
    const all = await view(alice, projectId);
    const stage = all.stages.find((s) => s.status === "in_progress")!;
    const design = all.stages[2]!;
    const item = stage.checklist[0]!;
    const evidence = design.evidence[0]!;
    const approval = all.stages[0]!.approvals[0]!;
    const [milestone] = await lifecycle.listMilestones(alice, projectId);
    const [risk] = await lifecycle.listRisks(alice, projectId);
    const templateId = all.lifecycle!.templateId;
    const [artifact] = await artifacts.listArtifacts(alice, projectId);
    await lifecycle.initializeProjectLifecycle(bob, bobProjectId);
    const bobStage = (await view(bob, bobProjectId)).stages[0]!;

    const calls: (() => Promise<unknown>)[] = [
      // Alice's project is invisible to Bob.
      () => lifecycle.getProjectLifecycle(bob, projectId),
      () => lifecycle.initializeProjectLifecycle(bob, projectId),
      () => lifecycle.updateLifecycle(bob, projectId, { status: "archived" }),
      () => lifecycle.updateStage(bob, projectId, stage.id, { notes: "hijack" }),
      () => lifecycle.startStage(bob, projectId, stage.id),
      () => lifecycle.blockStage(bob, projectId, stage.id, "hijack"),
      () => lifecycle.completeStage(bob, projectId, stage.id),
      () => lifecycle.skipStage(bob, projectId, stage.id, "hijack"),
      () => lifecycle.reopenStage(bob, projectId, all.stages[0]!.id, "hijack"),
      () => lifecycle.stageActivity(bob, projectId, stage.id),
      () => lifecycle.listChecklistItems(bob, projectId, stage.id),
      () => lifecycle.createChecklistItem(bob, projectId, stage.id, { title: "hijack", description: "", itemType: "task", isRequired: false }),
      () => lifecycle.updateChecklistItem(bob, projectId, stage.id, item.id, { status: "completed" }),
      () => lifecycle.waiveChecklistItem(bob, projectId, stage.id, item.id, "hijack"),
      () => lifecycle.deleteChecklistItem(bob, projectId, stage.id, item.id),
      () => lifecycle.listStageEvidence(bob, projectId, design.id),
      () => lifecycle.addStageEvidence(bob, projectId, stage.id, { evidenceType: "note", title: "hijack", note: "x" }),
      () => lifecycle.supersedeStageEvidence(bob, projectId, design.id, evidence.id, "hijack"),
      () => lifecycle.requestStageApproval(bob, projectId, stage.id, { reviewerId: bob.userId, note: "hijack" }),
      () => lifecycle.decideStageApproval(bob, projectId, all.stages[0]!.id, approval.id, "approve", ""),
      () => lifecycle.listMilestones(bob, projectId),
      () => lifecycle.createMilestone(bob, projectId, { name: "hijack", description: "", status: "planned", ownerId: null, dueAt: null }),
      () => lifecycle.updateMilestone(bob, projectId, milestone!.id, { status: "cancelled" }),
      () => lifecycle.deleteMilestone(bob, projectId, milestone!.id),
      () => lifecycle.listRisks(bob, projectId),
      () => lifecycle.createRisk(bob, projectId, { title: "hijack", description: "", category: "other", likelihood: 1, impact: 1, status: "open", ownerId: null, mitigation: "", dueAt: null }),
      () => lifecycle.updateRisk(bob, projectId, risk!.id, { status: "closed" }),
      // Bob's own project cannot reach Alice's stages, items, evidence, approvals, milestones, risks, artifacts or templates.
      () => lifecycle.startStage(bob, bobProjectId, stage.id),
      () => lifecycle.updateStage(bob, bobProjectId, stage.id, { notes: "hijack" }),
      () => lifecycle.reopenStage(bob, bobProjectId, all.stages[0]!.id, "hijack"),
      () => lifecycle.stageActivity(bob, bobProjectId, stage.id),
      () => lifecycle.updateChecklistItem(bob, bobProjectId, bobStage.id, item.id, { status: "completed" }),
      () => lifecycle.waiveChecklistItem(bob, bobProjectId, bobStage.id, item.id, "hijack"),
      () => lifecycle.deleteChecklistItem(bob, bobProjectId, bobStage.id, item.id),
      () => lifecycle.addStageEvidence(bob, bobProjectId, bobStage.id, { evidenceType: "note", title: "hijack", note: "x", checklistItemId: item.id }),
      () => lifecycle.addStageEvidence(bob, bobProjectId, bobStage.id, { evidenceType: "artifact", title: "hijack", artifactId: artifact!.artifact.id }),
      () => lifecycle.supersedeStageEvidence(bob, bobProjectId, bobStage.id, evidence.id, "hijack"),
      () => lifecycle.decideStageApproval(bob, bobProjectId, bobStage.id, approval.id, "approve", ""),
      () => lifecycle.updateMilestone(bob, bobProjectId, milestone!.id, { status: "cancelled" }),
      () => lifecycle.deleteMilestone(bob, bobProjectId, milestone!.id),
      () => lifecycle.updateRisk(bob, bobProjectId, risk!.id, { status: "closed" }),
      () => lifecycle.resolveRisk(bob, bobProjectId, risk!.id),
      () => templates.getLifecycleTemplate(bob, templateId),
      () => templates.updateLifecycleTemplate(bob, templateId, { name: "hijack", description: "", stages: [], expectedVersion: 1 }),
      () => templates.setDefaultLifecycleTemplate(bob, templateId),
      () => templates.setLifecycleTemplateActive(bob, templateId, false),
      () => templates.createLifecycleTemplate(bob, { name: "Copy of theirs", description: "", fromTemplateId: templateId }),
      async () => lifecycle.initializeProjectLifecycle(bob, (await projects.createProject(bob, { name: "Bob second", description: "", context: "" })).id, templateId),
      // Alice cannot use a stage of one of her projects through another of her projects either.
      () => lifecycle.startStage(alice, otherProjectId, stage.id),
      () => lifecycle.updateMilestone(alice, otherProjectId, milestone!.id, { status: "cancelled" }),
      () => lifecycle.updateRisk(alice, otherProjectId, risk!.id, { status: "closed" }),
    ];
    for (const [index, call] of calls.entries()) {
      const error = await call().then(() => null, (e: unknown) => e);
      expect(error, `call ${index} should be denied`).toBeInstanceOf(AppError);
      expect((error as AppError).code, `call ${index}: ${(error as AppError).message}`).toBe("not_found");
    }

    // Nothing of Alice's leaks into Bob's lists, and nothing changed on Alice's side.
    const bobPortfolio = await lifecycle.getPortfolio(bob, { includeArchived: true });
    expect(bobPortfolio.rows.map((r) => r.project.name).sort()).toEqual(["Bob project", "Bob second"]);
    expect(bobPortfolio.milestones).toEqual([]);
    expect((await lifecycle.listMembers(bob)).map((m) => m.name)).toEqual(["Bob"]);
    expect((await templates.listLifecycleTemplates(bob)).map((t) => t.id)).not.toContain(templateId);
    expect((await lifecycle.getLifecyclePortfolioStats(bob)).highRisks).toBe(0);
    expect((await view(alice, projectId)).stages.map((s) => s.status)).toEqual(all.stages.map((s) => s.status));
    expect((await lifecycle.listMilestones(alice, projectId))[0]!.status).toBe(milestone!.status);
  });

  it("reports the portfolio and Mission Control figures from persisted rows", async () => {
    const now = new Date();
    const stats = await lifecycle.getLifecyclePortfolioStats(alice, now);
    const { rows } = await lifecycle.getPortfolio(alice, { now });
    const main = rows.find((r) => r.project.id === projectId)!;
    expect(main.lifecycle).toMatchObject({ status: "active", percent: 43, requiredStages: 7, requiredStagesDone: 3, currentStage: { stageKey: "build", name: "Build", status: "in_progress" }, blockedStages: 3, pendingApprovals: 0 });
    expect(main.project.owner).toBe("Alice");

    const live = rows.filter((r) => r.lifecycle?.status === "active");
    expect(stats.activeLifecycles).toBe(live.length);
    expect(stats.notStarted).toBe(rows.filter((r) => !r.lifecycle).length);
    expect(stats.notStarted).toBeGreaterThanOrEqual(1);
    expect(stats.byStage.reduce((n, s) => n + s.count, 0)).toBe(live.length);
    expect(stats.byStage.find((s) => s.stageKey === "build")?.count).toBe(1);
    expect(stats.blockedProjects).toBe(1);
    expect(stats.highRisks).toBe(1);
    expect(stats.pendingApprovals).toBe(0);
    expect(stats.overdueMilestones).toBe(0);
    expect(stats.attention.find((a) => a.projectId === projectId)?.reasons.map((r) => r.kind)).toEqual(["blocked"]);
    expect(stats.upcomingMilestones.map((m) => m.name)).toEqual(["Production go-live"]);

    // A pending approval and an overdue milestone show up immediately.
    const second = await stageOf(alice, otherProjectId, "initiate");
    await completeChecklist(alice, otherProjectId, "initiate");
    await lifecycle.requestStageApproval(carol, otherProjectId, second.id, { reviewerId: dave.userId, note: "Second project initiate." });
    await lifecycle.createMilestone(alice, otherProjectId, { name: "Steering committee", description: "", status: "planned", ownerId: null, dueAt: new Date("2022-01-01T00:00:00Z") });
    const next = await lifecycle.getLifecyclePortfolioStats(alice);
    expect(next.pendingApprovals).toBe(1);
    expect(next.overdueMilestones).toBe(1);
    expect(next.attention.find((a) => a.projectId === otherProjectId)?.reasons.map((r) => r.kind)).toEqual(["overdue", "approval"]);
    expect(next.upcomingMilestones[0]).toMatchObject({ name: "Steering committee", projectName: "Second project", overdue: true });

    // Archived projects leave the default portfolio and return when asked for.
    await projects.setProjectStatus(alice, otherProjectId, "archived");
    expect((await lifecycle.getPortfolio(alice)).rows.some((r) => r.project.id === otherProjectId)).toBe(false);
    expect((await lifecycle.getPortfolio(alice, { includeArchived: true })).rows.some((r) => r.project.id === otherProjectId)).toBe(true);
    expect((await lifecycle.getLifecyclePortfolioStats(alice)).pendingApprovals).toBe(0);
  });

  it("holds and archives a lifecycle, and validates lifecycle status changes", async () => {
    const stage = (await view(alice, projectId)).stages.find((s) => s.status === "in_progress")!;
    const held = await lifecycle.updateLifecycle(carol, projectId, { status: "on_hold", note: "Budget review.", targetEndAt: new Date("2031-06-30T00:00:00Z") });
    expect(held.lifecycle).toMatchObject({ status: "on_hold", targetEndAt: "2031-06-30T00:00:00.000Z" });
    await expectError(lifecycle.updateStage(alice, projectId, stage.id, { notes: "While on hold." }), "precondition_failed", /on hold/);
    await expectError(lifecycle.updateChecklistItem(alice, projectId, stage.id, stage.checklist[0]!.id, { notes: "x" }), "precondition_failed");
    await expectError(lifecycle.updateLifecycle(alice, projectId, { status: "completed" }), "precondition_failed");
    await lifecycle.updateLifecycle(alice, projectId, { status: "archived" });
    await expectError(lifecycle.updateLifecycle(alice, projectId, { status: "on_hold" }), "precondition_failed");
    const active = await lifecycle.updateLifecycle(alice, projectId, { status: "active" });
    expect(active.lifecycle!.status).toBe("active");
    await expectError(lifecycle.updateLifecycle(alice, projectId, { status: "completed" }), "precondition_failed", /Build/);
    // Milestones and risks belong to the project and stay editable whatever the lifecycle status.
    expect((await lifecycle.createMilestone(alice, projectId, { name: "Budget decision", description: "", status: "planned", ownerId: null, dueAt: null })).id).toBeTruthy();
  });

  it("appends audit events for lifecycle, stage, checklist, evidence and approval changes without leaking content", async () => {
    const events = await getDb().select().from(schema.auditEvents).where(and(eq(schema.auditEvents.workspaceId, alice.workspaceId), eq(schema.auditEvents.projectId, projectId)));
    const lifecycleEvents = events.filter((e) => e.action.startsWith("lifecycle."));
    const actions = new Set(lifecycleEvents.map((e) => e.action));
    for (const action of [
      "lifecycle.initialize", "lifecycle.status", "lifecycle.target-date",
      "lifecycle.stage.start", "lifecycle.stage.block", "lifecycle.stage.unblock", "lifecycle.stage.complete", "lifecycle.stage.skip", "lifecycle.stage.reopen", "lifecycle.stage.update",
      "lifecycle.checklist.create", "lifecycle.checklist.complete", "lifecycle.checklist.reopen", "lifecycle.checklist.waive", "lifecycle.checklist.delete",
      "lifecycle.evidence.add", "lifecycle.evidence.supersede",
      "lifecycle.approval.request", "lifecycle.approval.approve", "lifecycle.approval.reject", "lifecycle.approval.withdraw",
    ]) {
      expect(actions, action).toContain(action);
    }
    expect(lifecycleEvents.every((e) => e.actorId && e.correlationId && e.summary.length > 0)).toBe(true);
    const assignment = lifecycleEvents.find((e) => e.action === "lifecycle.stage.update" && "ownerId" in e.metadata)!;
    expect(assignment.metadata).toMatchObject({ ownerId: { from: null, to: carol.userId }, reviewerId: { from: null, to: dave.userId }, dueAt: { from: null, to: "2030-03-31T00:00:00.000Z" } });
    // Evidence notes and URLs are content, not audit metadata.
    const serialized = JSON.stringify(lifecycleEvents.filter((e) => e.action.startsWith("lifecycle.evidence")).map((e) => e.metadata));
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("security architect");

    const design = await stageOf(alice, projectId, "design");
    const stageEvents = await lifecycle.stageActivity(alice, projectId, design.id, 100);
    expect(stageEvents.map((e) => e.action)).toEqual(expect.arrayContaining(["lifecycle.stage.start", "lifecycle.evidence.add", "lifecycle.approval.request", "lifecycle.approval.approve", "lifecycle.stage.complete", "lifecycle.stage.block", "lifecycle.stage.reopen", "lifecycle.stage.skip"]));
    const mission = await recentActivity(alice, { actionPrefix: "lifecycle.", limit: 5 });
    expect(mission).toHaveLength(5);
    expect(mission.every((e) => e.action.startsWith("lifecycle."))).toBe(true);
  });
});

describe("lifecycle consistency", () => {
  const settle = async (calls: (() => Promise<unknown>)[]) => {
    const results = await Promise.allSettled(calls.map((call) => call()));
    // A refused request is a clean application error, never a raw database failure.
    for (const r of results) if (r.status === "rejected") expect(r.reason, String(r.reason)).toBeInstanceOf(AppError);
    return results;
  };
  const start = async (name: string, templateId?: string) => {
    const project = await projects.createProject(alice, { name, description: "", context: "" });
    await lifecycle.initializeProjectLifecycle(alice, project.id, templateId);
    return project.id;
  };
  const plain = (stageKey: string, isRequired = true) => ({ stageKey, name: stageKey.toUpperCase(), description: "", isRequired, requiresApproval: false, defaultDurationDays: null, readinessRules: [], checklist: [] });
  let simpleTemplateId: string;

  beforeAll(async () => {
    simpleTemplateId = (await templates.createLifecycleTemplate(alice, { name: "Ungated three-step", description: "", stages: [plain("a"), plain("b"), plain("c", false)] })).id;
  });

  it("does not let a checklist change slip past a gate that is being requested or decided at the same moment", async () => {
    const openRequired = (v: Awaited<ReturnType<typeof view>>) => v.stages[0]!.checklist.filter((i) => i.isRequired && i.status !== "completed" && i.status !== "waived").length;
    for (let round = 0; round < 6; round += 1) {
      const id = await start(`Gate race ${round}`);
      const stage = await completeChecklist(alice, id, "initiate");
      const item = stage.checklist[round % stage.checklist.length]!;
      await settle([
        () => lifecycle.requestStageApproval(carol, id, stage.id, { reviewerId: dave.userId, note: "Racing request." }),
        () => lifecycle.updateChecklistItem(alice, id, stage.id, item.id, { status: "pending" }),
      ]);
      let after = await view(alice, id);
      // Either the request won and the checklist is frozen complete, or the item was reopened first and no request exists.
      if (after.stages[0]!.status === "pending_approval") expect(openRequired(after), `round ${round}`).toBe(0);
      else expect(after.stages[0]!.approvals, `round ${round}`).toHaveLength(0);

      if (after.stages[0]!.status !== "pending_approval") {
        await lifecycle.updateChecklistItem(alice, id, stage.id, item.id, { status: "completed" });
        await lifecycle.requestStageApproval(carol, id, stage.id, { reviewerId: dave.userId, note: "Request." });
      }
      const approval = (await view(alice, id)).stages[0]!.approvals[0]!;
      // The checklist is frozen during review, so a concurrent reopen is refused and the approval stands on a complete checklist.
      await settle([
        () => lifecycle.decideStageApproval(dave, id, stage.id, approval.id, "approve", ""),
        () => lifecycle.updateChecklistItem(alice, id, stage.id, item.id, { status: "pending" }),
      ]);
      after = await view(alice, id);
      expect(after.stages[0]!.status, `round ${round}`).toBe("completed");
      expect(openRequired(after), `round ${round}`).toBe(0);
    }
  });

  it("keeps stage order when a stage is started while the one before it is reopened", async () => {
    for (let round = 0; round < 6; round += 1) {
      const id = await start(`Order race ${round}`, simpleTemplateId);
      const [a, b] = (await view(alice, id)).stages;
      await lifecycle.completeStage(alice, id, a!.id);
      await settle([() => lifecycle.startStage(alice, id, b!.id), () => lifecycle.reopenStage(alice, id, a!.id, "Rework.")]);
      const after = (await view(alice, id)).stages.map((s) => s.status);
      // Start-then-reopen holds B for review; reopen-then-start refuses the start. B is never in progress beside an open A.
      expect(["blocked", "not_started"], `round ${round}: ${after.join(",")}`).toContain(after[1]);
      expect(after[0]).toBe("in_progress");
    }
  });

  it("never leaves a lifecycle completed with a required stage open", async () => {
    for (let round = 0; round < 6; round += 1) {
      const id = await start(`Completion race ${round}`, simpleTemplateId);
      const [a, b] = (await view(alice, id)).stages;
      await lifecycle.completeStage(alice, id, a!.id);
      await lifecycle.startStage(alice, id, b!.id);
      await lifecycle.completeStage(alice, id, b!.id);
      await settle([() => lifecycle.updateLifecycle(alice, id, { status: "completed" }), () => lifecycle.reopenStage(alice, id, b!.id, "Rework.")]);
      const after = await view(alice, id);
      expect(after.stages[1]!.status).toBe("in_progress");
      expect(after.lifecycle!.status, `round ${round}`).toBe("active");
      expect(after.lifecycle!.completedAt).toBeNull();
    }
  });

  it("applies stage order to reopening a skipped stage", async () => {
    const id = await start("Reopen a skipped stage", simpleTemplateId);
    const [a, b] = (await view(alice, id)).stages;
    await lifecycle.completeStage(alice, id, a!.id);
    await lifecycle.skipStage(alice, id, b!.id, "Covered elsewhere.");
    await lifecycle.reopenStage(carol, id, a!.id, "Rework.");
    // B was skipped, so the cascade left it alone; it still cannot come back while A is open.
    expect((await view(alice, id)).stages.map((s) => s.status)).toEqual(["in_progress", "skipped", "not_started"]);
    await expectError(lifecycle.reopenStage(carol, id, b!.id, "Bring it back."), "precondition_failed", /cannot be reopened yet\. Complete or skip “A” first/);
    await lifecycle.completeStage(alice, id, a!.id);
    const reopened = await lifecycle.reopenStage(carol, id, b!.id, "Bring it back.");
    expect(reopened.stages.map((s) => s.status)).toEqual(["completed", "in_progress", "not_started"]);
  });

  it("saves stage details and a status change together or not at all", async () => {
    const id = await start("Atomic stage update");
    const stage = await stageOf(alice, id, "initiate");
    await expectError(lifecycle.updateStage(alice, id, stage.id, { reviewerId: dave.userId, notes: "Should not be saved.", dueAt: new Date("2031-01-01T00:00:00Z"), status: "completed" }), "precondition_failed");
    const after = await stageOf(alice, id, "initiate");
    expect(after).toMatchObject({ reviewer: null, notes: "", dueAt: null, status: "in_progress" });
    expect(await lifecycle.stageActivity(alice, id, stage.id)).toEqual([]);

    const blocked = await lifecycle.updateStage(alice, id, stage.id, { ownerId: carol.userId, status: "blocked", reason: "Waiting for the sponsor." });
    expect(blocked.stages[0]).toMatchObject({ status: "blocked", blockedReason: "Waiting for the sponsor.", owner: { id: carol.userId } });
  });

  it("does not let an editor review their own request, or the reviewer change under an open request", async () => {
    const id = await start("Self review");
    const stage = await completeChecklist(alice, id, "initiate");
    const self = await expectError(lifecycle.requestStageApproval(carol, id, stage.id, { reviewerId: carol.userId, note: "I will review this myself." }), "validation_error", /someone else/);
    expect(self.fieldErrors?.reviewerId).toBeDefined();
    await lifecycle.updateStage(alice, id, stage.id, { reviewerId: carol.userId });
    await expectError(lifecycle.requestStageApproval(carol, id, stage.id, { note: "The stage's reviewer is me." }), "validation_error");
    expect((await stageOf(alice, id, "initiate")).status).toBe("in_progress");

    const approval = await lifecycle.requestStageApproval(carol, id, stage.id, { reviewerId: dave.userId, note: "Dave reviews." });
    await expectError(lifecycle.updateStage(alice, id, stage.id, { reviewerId: carol.userId }), "precondition_failed", /Withdraw the request to change its reviewer/);
    expect((await stageOf(alice, id, "initiate")).approvals[0]!.reviewer?.id).toBe(dave.userId);
    // An owner in a one-person workspace has nobody else, so an owner may decide their own request.
    await lifecycle.decideStageApproval(carol, id, stage.id, approval.id, "withdraw", "");
    const own = await lifecycle.requestStageApproval(alice, id, stage.id, { reviewerId: alice.userId, note: "Owner reviews." });
    expect((await lifecycle.decideStageApproval(alice, id, stage.id, own.id, "approve", "")).stageStatus).toBe("completed");
  });

  it("keeps exactly one active default template when changes race", async () => {
    const other = await templates.createLifecycleTemplate(alice, { name: "Racing default", description: "" });
    const [builtIn] = (await templates.listLifecycleTemplates(alice)).filter((t) => t.builtIn);
    for (let round = 0; round < 6; round += 1) {
      await settle([
        () => templates.setDefaultLifecycleTemplate(alice, other.id),
        () => templates.setLifecycleTemplateActive(carol, other.id, false),
        () => templates.setDefaultLifecycleTemplate(alice, round % 2 ? builtIn!.id : other.id),
      ]);
      const list = await templates.listLifecycleTemplates(alice);
      expect(list.filter((t) => t.isDefault), `round ${round}`).toHaveLength(1);
      expect(list.filter((t) => t.isDefault && t.isActive), `round ${round}`).toHaveLength(1);
      await templates.setDefaultLifecycleTemplate(alice, builtIn!.id);
      await templates.setLifecycleTemplateActive(alice, other.id, true);
    }
    const names = await settle(Array.from({ length: 4 }, () => () => templates.createLifecycleTemplate(carol, { name: "Same name at once", description: "" })));
    expect(names.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of names) if (r.status === "rejected") expect((r.reason as AppError).code).toBe("conflict");
  });

  it("copies one consistent template version when the template is edited while a lifecycle starts", async () => {
    const template = await templates.createLifecycleTemplate(alice, { name: "Edited during start", description: "", stages: [plain("a"), plain("b")] });
    let version = template.version;
    for (let round = 0; round < 6; round += 1) {
      const project = await projects.createProject(alice, { name: `Start during edit ${round}`, description: "", context: "" });
      const stages = round % 2 ? [plain("a"), plain("b")] : [plain("x"), plain("y"), plain("z")];
      await settle([
        () => lifecycle.initializeProjectLifecycle(alice, project.id, template.id),
        () => templates.updateLifecycleTemplate(alice, template.id, { name: template.name, description: "", stages, expectedVersion: version }),
      ]);
      version += 1;
      const started = await view(alice, project.id);
      // Whichever came first, the lifecycle holds the stages of exactly the version it recorded.
      expect(started.lifecycle, `round ${round}`).not.toBeNull();
      const expected = started.lifecycle!.templateVersion === version ? stages.length : round === 0 ? 2 : round % 2 ? 3 : 2;
      expect(started.stages, `round ${round}: v${started.lifecycle!.templateVersion}`).toHaveLength(expected);
    }
  });

  it("flags a stage whose due date has passed in every place it is counted", async () => {
    const id = await start("Late before it starts");
    const discover = await stageOf(alice, id, "discover");
    const after = await lifecycle.updateStage(alice, id, discover.id, { dueAt: new Date("2020-06-01T00:00:00Z") });
    expect(after.stages[1]).toMatchObject({ status: "not_started", overdue: true });
    expect(after.progress!.overdueStageIds).toEqual([discover.id]);
    const row = (await lifecycle.getPortfolio(alice)).rows.find((r) => r.project.id === id)!;
    expect(row.lifecycle!.overdueStages).toBe(1);
    expect(row.overdue).toBe(true);
    expect((await lifecycle.getLifecyclePortfolioStats(alice)).attention.find((a) => a.projectId === id)?.reasons.map((r) => r.text)).toEqual(["1 overdue stage"]);
  });
});

