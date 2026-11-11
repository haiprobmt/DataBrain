import { describe, expect, it } from "vitest";
import {
  canTransitionLifecycle,
  canTransitionStage,
  computeProgress,
  DEFAULT_LIFECYCLE_TEMPLATE,
  evaluateReadiness,
  evidenceUrlProblem,
  isChecklistItemSatisfied,
  isHighRisk,
  isOverdue,
  normalizeReadinessRules,
  outstandingRequiredItems,
  READINESS_RULES,
  riskLevel,
  riskScore,
  STAGE_LINKS,
  STAGE_STATUSES,
  stageStartCheck,
  type ChecklistFact,
  type ReadinessFacts,
  type StageProgressInput,
  type StageStatus,
} from "@/lib/lifecycle";
import { checklistWaiveSchema, evidenceCreateSchema, milestoneCreateSchema, readinessRulesSchema, riskCreateSchema, riskUpdateSchema, stageUpdateSchema, templateUpdateSchema } from "@/lib/lifecycle-schemas";

const NOW = new Date("2026-06-15T10:30:00Z");

const item = (id: string, patch: Partial<ChecklistFact> = {}): ChecklistFact => ({ id, title: `Item ${id}`, isRequired: true, itemType: "task", status: "pending", ...patch });

const facts = (patch: Partial<ReadinessFacts> = {}): ReadinessFacts => ({
  stageName: "Discover",
  checklist: [item("a", { status: "completed" })],
  itemsWithEvidence: [],
  requirementsStatus: "approved",
  blueprint: { exists: true, approved: true },
  deployment: { planExists: true, dryRunSucceeded: true },
  latestApproval: "approved",
  ...patch,
});

/** Eight stages in template order with the given statuses; the last one is the optional stage. */
const stages = (...statuses: StageStatus[]): StageProgressInput[] =>
  DEFAULT_LIFECYCLE_TEMPLATE.stages.map((s, i) => ({ id: s.stageKey, stageKey: s.stageKey, name: s.name, sortOrder: i + 1, isRequired: s.isRequired, status: statuses[i] ?? "not_started", dueAt: null }));

describe("default lifecycle template", () => {
  const template = DEFAULT_LIFECYCLE_TEMPLATE;

  it("has the eight stages in order with unique keys", () => {
    expect(template.name).toBe("Data & AI Project Lifecycle");
    expect(template.stages.map((s) => s.stageKey)).toEqual(["initiate", "discover", "design", "build", "validate", "release", "operate", "improve_retire"]);
    expect(template.stages.map((s) => s.name)).toEqual(["Initiate", "Discover", "Design", "Build", "Validate", "Release", "Operate", "Improve & Retire"]);
    expect(new Set(template.stages.map((s) => s.stageKey)).size).toBe(8);
  });

  it("makes only Improve & Retire optional and gives every stage an approval gate and a checklist", () => {
    expect(template.stages.filter((s) => !s.isRequired).map((s) => s.stageKey)).toEqual(["improve_retire"]);
    for (const stage of template.stages) {
      expect(stage.requiresApproval, stage.stageKey).toBe(true);
      expect(stage.checklist.length, stage.stageKey).toBeGreaterThanOrEqual(5);
      expect(stage.readinessRules, stage.stageKey).toEqual(expect.arrayContaining(["required_checklist_complete", "stage_approval_recorded"]));
      expect(new Set(stage.checklist.map((c) => c.title)).size, stage.stageKey).toBe(stage.checklist.length);
      // Every rule in the template is one the evaluator supports.
      expect(readinessRulesSchema.safeParse(stage.readinessRules).success, stage.stageKey).toBe(true);
    }
  });

  it("maps Discover, Design and Release to the existing DataBrain records", () => {
    const rules = (key: string) => template.stages.find((s) => s.stageKey === key)!.readinessRules;
    expect(rules("discover")).toContain("requirements_approved");
    expect(rules("design")).toContain("blueprint_approved");
    expect(rules("release")).toContain("deployment_dry_run_succeeded");
    expect(rules("build")).toEqual(["required_checklist_complete", "stage_approval_recorded"]);
    expect(Object.keys(STAGE_LINKS).sort()).toEqual(template.stages.map((s) => s.stageKey).sort());
    expect(STAGE_LINKS.release?.[0]?.path).toBe("/deployments");
  });
});

describe("readiness rule validation", () => {
  it("accepts every supported rule and rejects an unknown one instead of ignoring it", () => {
    expect(readinessRulesSchema.parse([...READINESS_RULES])).toHaveLength(6);
    expect(readinessRulesSchema.safeParse(["required_checklist_complete", "tests_passed"]).success).toBe(false);
    const stage = { stageKey: "build", name: "Build", readinessRules: ["made_up_rule"] };
    expect(templateUpdateSchema.safeParse({ name: "Custom", stages: [stage], expectedVersion: 1 }).success).toBe(false);
  });

  it("validates template stages: unique keys, key format, and at least one required stage", () => {
    const stage = (stageKey: string, isRequired = true) => ({ stageKey, name: "Stage", isRequired });
    const parse = (list: unknown[]) => templateUpdateSchema.safeParse({ name: "Custom", stages: list, expectedVersion: 1 });
    expect(parse([stage("plan"), stage("build")]).success).toBe(true);
    expect(parse([stage("plan"), stage("plan")]).success).toBe(false);
    expect(parse([stage("Plan Stage")]).success).toBe(false);
    expect(parse([stage("plan", false)]).success).toBe(false);
    expect(parse([]).success).toBe(false);
  });

  it("keeps the approval rule in step with requiresApproval and returns rules in canonical order", () => {
    expect(normalizeReadinessRules(["blueprint_approved", "required_checklist_complete"], true)).toEqual(["required_checklist_complete", "blueprint_approved", "stage_approval_recorded"]);
    expect(normalizeReadinessRules(["stage_approval_recorded", "required_checklist_complete", "required_checklist_complete"], false)).toEqual(["required_checklist_complete"]);
  });
});

describe("stage transitions", () => {
  const allowed: [StageStatus, StageStatus][] = [
    ["not_started", "in_progress"],
    ["not_started", "skipped"],
    ["in_progress", "blocked"],
    ["in_progress", "pending_approval"],
    ["in_progress", "completed"],
    ["in_progress", "skipped"],
    ["blocked", "in_progress"],
    ["pending_approval", "in_progress"],
    ["pending_approval", "completed"],
    ["completed", "in_progress"],
    ["skipped", "in_progress"],
  ];

  it("allows exactly the documented transitions", () => {
    for (const from of STAGE_STATUSES) {
      for (const to of STAGE_STATUSES) {
        expect(canTransitionStage(from, to), `${from} → ${to}`).toBe(allowed.some(([f, t]) => f === from && t === to));
      }
    }
  });

  it("never lets a stage jump from not started or blocked straight to completed", () => {
    expect(canTransitionStage("not_started", "completed")).toBe(false);
    expect(canTransitionStage("blocked", "completed")).toBe(false);
    expect(canTransitionStage("not_started", "pending_approval")).toBe(false);
  });

  it("orders required stages and lets the optional stage start once Operate is reached", () => {
    const early = stages("completed", "in_progress");
    expect(stageStartCheck(early, "design")).toMatchObject({ allowed: false });
    expect(stageStartCheck(early, "design").reason).toContain("“Discover”");
    expect(stageStartCheck(stages("completed", "skipped"), "design").allowed).toBe(true);
    expect(stageStartCheck(stages("completed", "completed", "completed"), "release").reason).toMatch(/“Build”, “Validate”/);

    const beforeOperate = stages("completed", "completed", "completed", "completed", "completed", "completed", "not_started");
    expect(stageStartCheck(beforeOperate, "improve_retire")).toMatchObject({ allowed: false });
    expect(stageStartCheck(beforeOperate, "improve_retire").reason).toContain("“Operate”");
    const operating = stages("completed", "completed", "completed", "completed", "completed", "completed", "in_progress");
    expect(stageStartCheck(operating, "improve_retire").allowed).toBe(true);
    expect(stageStartCheck(operating, "no-such-stage").allowed).toBe(false);
  });

  it("validates lifecycle status transitions", () => {
    expect(canTransitionLifecycle("active", "on_hold")).toBe(true);
    expect(canTransitionLifecycle("on_hold", "active")).toBe(true);
    expect(canTransitionLifecycle("on_hold", "completed")).toBe(false);
    expect(canTransitionLifecycle("archived", "completed")).toBe(false);
    expect(canTransitionLifecycle("active", "not_started")).toBe(false);
  });
});

describe("checklist completion and waivers", () => {
  it("treats completed as satisfied, and waived only with a recorded reason", () => {
    expect(isChecklistItemSatisfied({ status: "completed" })).toBe(true);
    expect(isChecklistItemSatisfied({ status: "waived", waivedReason: "Not applicable: no PII in scope." })).toBe(true);
    expect(isChecklistItemSatisfied({ status: "waived", waivedReason: "   " })).toBe(false);
    expect(isChecklistItemSatisfied({ status: "waived", waivedReason: null })).toBe(false);
    expect(isChecklistItemSatisfied({ status: "in_progress" })).toBe(false);
    expect(isChecklistItemSatisfied({ status: "pending" })).toBe(false);
  });

  it("counts only required items as outstanding", () => {
    const list = [item("a"), item("b", { isRequired: false }), item("c", { status: "completed" }), item("d", { status: "waived", waivedReason: "Agreed with sponsor." }), item("e", { status: "in_progress" })];
    expect(outstandingRequiredItems(list).map((i) => i.id)).toEqual(["a", "e"]);
  });

  it("requires a reason to waive", () => {
    expect(checklistWaiveSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(checklistWaiveSchema.safeParse({ reason: "  " }).success).toBe(false);
    expect(checklistWaiveSchema.parse({ reason: " Out of scope for phase one. " }).reason).toBe("Out of scope for phase one.");
  });
});

describe("readiness evaluator", () => {
  const all = [...READINESS_RULES];

  it("passes when every fact holds, and reports one result per rule", () => {
    const result = evaluateReadiness(all, facts({ checklist: [item("a", { status: "completed", itemType: "evidence" })], itemsWithEvidence: ["a"] }));
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.rules.map((r) => r.rule)).toEqual(all);
    expect(result.rules.every((r) => r.passed)).toBe(true);
  });

  it("reports open required checklist items with machine-readable and human-readable detail", () => {
    const result = evaluateReadiness(["required_checklist_complete"], facts({ checklist: [item("a"), item("b", { isRequired: false }), item("c", { status: "in_progress" })] }));
    expect(result.ready).toBe(false);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toMatchObject({ code: "required_checklist_incomplete", rule: "required_checklist_complete", path: null, itemIds: ["a", "c"] });
    expect(result.blockers[0]!.message).toMatch(/^2 required checklist items are still open in Discover: Item a · Item c$/);
  });

  it("distinguishes missing requirements from unapproved ones", () => {
    const none = evaluateReadiness(["requirements_approved"], facts({ requirementsStatus: "none" }));
    expect(none.blockers[0]).toMatchObject({ code: "requirements_not_started", path: "/requirements" });
    const draft = evaluateReadiness(["requirements_approved"], facts({ requirementsStatus: "draft" }));
    expect(draft.blockers[0]).toEqual({ code: "requirements_not_approved", rule: "requirements_approved", message: "Approve the project requirements before completing Discover.", path: "/requirements" });
  });

  it("reports a missing blueprint as missing, not as an error or a fabricated status", () => {
    const missing = evaluateReadiness(["blueprint_approved"], facts({ stageName: "Design", blueprint: { exists: false, approved: false } }));
    expect(missing.blockers[0]).toMatchObject({ code: "blueprint_missing", path: "/blueprint" });
    expect(missing.blockers[0]!.message).toContain("no blueprint yet");
    const draft = evaluateReadiness(["blueprint_approved"], facts({ stageName: "Design", blueprint: { exists: true, approved: false } }));
    expect(draft.blockers[0]).toMatchObject({ code: "blueprint_not_approved", message: "Approve the Solution Blueprint before completing Design." });
  });

  it("requires a deployment plan and a successful dry-run of it", () => {
    const noPlan = evaluateReadiness(["deployment_dry_run_succeeded"], facts({ stageName: "Release", deployment: { planExists: false, dryRunSucceeded: false } }));
    expect(noPlan.blockers[0]).toMatchObject({ code: "deployment_plan_missing", path: "/deployments" });
    const noRun = evaluateReadiness(["deployment_dry_run_succeeded"], facts({ stageName: "Release", deployment: { planExists: true, dryRunSucceeded: false } }));
    expect(noRun.blockers[0]).toMatchObject({ code: "deployment_dry_run_missing", path: "/deployments" });
  });

  it("requires evidence on required evidence items unless they are waived", () => {
    const checklist = [item("a", { itemType: "evidence", status: "completed" }), item("b", { itemType: "evidence", status: "waived", waivedReason: "n/a" }), item("c", { itemType: "evidence", isRequired: false }), item("d", { status: "completed" })];
    const missing = evaluateReadiness(["required_evidence_present"], facts({ checklist, itemsWithEvidence: [] }));
    expect(missing.blockers[0]).toMatchObject({ code: "required_evidence_missing", itemIds: ["a"] });
    expect(evaluateReadiness(["required_evidence_present"], facts({ checklist, itemsWithEvidence: ["a"] })).ready).toBe(true);
  });

  it("separates the request gate from the completion gate", () => {
    const rules = DEFAULT_LIFECYCLE_TEMPLATE.stages[0]!.readinessRules;
    const noApproval = facts({ latestApproval: null });
    expect(evaluateReadiness(rules, noApproval, "request").ready).toBe(true);
    const complete = evaluateReadiness(rules, noApproval, "complete");
    expect(complete.ready).toBe(false);
    expect(complete.blockers.map((b) => b.code)).toEqual(["stage_approval_missing"]);
    expect(evaluateReadiness(rules, facts({ latestApproval: "requested" })).blockers[0]?.code).toBe("stage_approval_pending");
    expect(evaluateReadiness(rules, facts({ latestApproval: "rejected" })).blockers[0]?.code).toBe("stage_approval_rejected");
    expect(evaluateReadiness(rules, facts({ latestApproval: "withdrawn" })).blockers[0]?.code).toBe("stage_approval_missing");
    expect(evaluateReadiness(rules, facts({ latestApproval: "approved" })).ready).toBe(true);
  });

  it("reports every failing rule, not just the first", () => {
    const result = evaluateReadiness(all, facts({ checklist: [item("a")], requirementsStatus: "draft", blueprint: { exists: false, approved: false }, deployment: { planExists: false, dryRunSucceeded: false }, latestApproval: null }));
    expect(result.blockers.map((b) => b.code)).toEqual(["required_checklist_incomplete", "requirements_not_approved", "blueprint_missing", "deployment_plan_missing", "stage_approval_missing"]);
    expect(result.rules.filter((r) => r.passed).map((r) => r.rule)).toEqual(["required_evidence_present"]);
  });
});

describe("progress", () => {
  it("counts required stages only, so the optional stage never lowers progress", () => {
    const p = computeProgress(stages("completed", "completed", "in_progress"), [], NOW);
    expect(p.requiredStages).toBe(7);
    expect(p.requiredStagesDone).toBe(2);
    expect(p.percent).toBe(29);
    expect(p.currentStageId).toBe("design");
    const allRequired = computeProgress(stages("completed", "completed", "completed", "completed", "completed", "completed", "completed", "not_started"), [], NOW);
    expect(allRequired.percent).toBe(100);
    expect(allRequired.currentStageId).toBeNull();
  });

  it("counts an explicitly skipped stage as done and a pending approval as not done", () => {
    const p = computeProgress(stages("completed", "skipped", "pending_approval"), [], NOW);
    expect(p.requiredStagesDone).toBe(2);
    expect(p.skippedStages).toBe(1);
    expect(p.currentStageId).toBe("design");
    expect(p.pendingApprovalStageIds).toEqual(["design"]);
  });

  it("keeps the pointer on a blocked stage and moves to the optional stage only when it was started", () => {
    expect(computeProgress(stages("completed", "blocked"), [], NOW)).toMatchObject({ currentStageId: "discover", blockedStageIds: ["discover"] });
    const done = ["completed", "completed", "completed", "completed", "completed", "completed", "completed"] as StageStatus[];
    expect(computeProgress(stages(...done, "in_progress"), [], NOW).currentStageId).toBe("improve_retire");
    expect(computeProgress(stages(...done, "in_progress"), [], NOW).percent).toBe(100);
    expect(computeProgress(stages(...done, "completed"), [], NOW).currentStageId).toBeNull();
  });

  it("returns checklist counts and overdue stages as inputs to the figure", () => {
    const list = stages("completed", "in_progress", "not_started");
    list[0]!.dueAt = new Date("2026-06-01T00:00:00Z"); // done: not overdue
    list[1]!.dueAt = new Date("2026-06-10T00:00:00Z"); // open and past due
    list[2]!.dueAt = new Date("2026-06-10T00:00:00Z"); // not started: not flagged
    const checklist = [
      { ...item("a", { status: "completed" }), stageId: "initiate" },
      { ...item("b"), stageId: "discover" },
      { ...item("c", { isRequired: false }), stageId: "discover" },
      { ...item("d", { status: "waived", waivedReason: "ok" }), stageId: "discover" },
    ];
    const p = computeProgress(list, checklist, NOW);
    expect(p.overdueStageIds).toEqual(["discover"]);
    expect(p.checklist).toEqual({ total: 4, satisfied: 2, outstandingRequired: 1 });
  });

  it("handles a lifecycle with no stages", () => {
    expect(computeProgress([], [], NOW)).toMatchObject({ percent: 0, requiredStages: 0, currentStageId: null });
  });
});

describe("risk score", () => {
  it("is likelihood × impact with fixed bands", () => {
    expect(riskScore(1, 1)).toBe(1);
    expect(riskScore(3, 4)).toBe(12);
    expect(riskScore(5, 5)).toBe(25);
    expect([1, 4, 5, 9, 10, 15, 16, 25].map(riskLevel)).toEqual(["low", "low", "medium", "medium", "high", "high", "critical", "critical"]);
    expect(isHighRisk(2, 5)).toBe(true);
    expect(isHighRisk(3, 3)).toBe(false);
  });

  it("rejects values outside 1–5 and non-integers", () => {
    for (const [l, i] of [[0, 3], [6, 3], [3, 0], [3, 6], [2.5, 3], [Number.NaN, 3]] as const) {
      expect(() => riskScore(l, i), `${l}×${i}`).toThrow(RangeError);
    }
  });

  it("validates bounds at the API boundary and never accepts a client severity", () => {
    const base = { title: "Source extract is late", likelihood: 3, impact: 4 };
    expect(riskCreateSchema.parse(base)).toMatchObject({ status: "open", category: "delivery" });
    expect(riskCreateSchema.safeParse({ ...base, likelihood: 6 }).success).toBe(false);
    expect(riskCreateSchema.safeParse({ ...base, impact: 0 }).success).toBe(false);
    expect(riskCreateSchema.safeParse({ ...base, impact: 2.5 }).success).toBe(false);
    expect(riskCreateSchema.safeParse({ ...base, severity: 25 }).success).toBe(false);
    expect(riskUpdateSchema.safeParse({ severity: 1 }).success).toBe(false);
    expect(riskCreateSchema.safeParse({ ...base, category: "weather" }).success).toBe(false);
  });
});

describe("due dates", () => {
  it("is overdue only after the due day has fully passed and the work is open", () => {
    expect(isOverdue("2026-06-14T00:00:00Z", false, NOW)).toBe(true);
    expect(isOverdue("2026-06-15T00:00:00Z", false, NOW)).toBe(false); // due today
    expect(isOverdue(new Date("2026-06-16T00:00:00Z"), false, NOW)).toBe(false);
    expect(isOverdue("2026-06-01T00:00:00Z", true, NOW)).toBe(false); // done
    expect(isOverdue(null, false, NOW)).toBe(false);
    expect(isOverdue("2026-06-14T23:59:59Z", false, new Date("2026-06-15T00:00:00Z"))).toBe(true);
  });

  it("parses calendar days and rejects malformed or implausible dates", () => {
    expect(milestoneCreateSchema.parse({ name: "UAT sign-off", dueAt: "2026-09-30" }).dueAt?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(milestoneCreateSchema.parse({ name: "UAT sign-off" }).dueAt).toBeNull();
    expect(stageUpdateSchema.parse({ dueAt: null }).dueAt).toBeNull();
    for (const bad of ["30/09/2026", "2026-13-01", "1999-01-01", "soon"]) expect(milestoneCreateSchema.safeParse({ name: "UAT sign-off", dueAt: bad }).success, bad).toBe(false);
  });
});

describe("evidence references", () => {
  it("accepts only http(s) links without credentials", () => {
    expect(evidenceUrlProblem("https://dev.azure.com/org/project/_build/results?buildId=42")).toBeNull();
    expect(evidenceUrlProblem("http://intranet.example/uat-report")).toBeNull();
    for (const bad of ["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "file:///etc/passwd", "ftp://files.example/report.pdf", "vbscript:msgbox(1)", "//example.com/x", "example.com/report", "", "https://user:secret@example.com/report", `https://example.com/${"a".repeat(2000)}`]) {
      expect(evidenceUrlProblem(bad), bad).not.toBeNull();
    }
  });

  it("validates each evidence type's fields", () => {
    const artifactId = "3f2b8c1e-5d7a-4c9b-8e1f-2a6d4b7c9e10";
    expect(evidenceCreateSchema.safeParse({ evidenceType: "url", title: "UAT report", url: "https://example.com/uat" }).success).toBe(true);
    expect(evidenceCreateSchema.safeParse({ evidenceType: "url", title: "UAT report", url: "javascript:alert(1)" }).success).toBe(false);
    expect(evidenceCreateSchema.safeParse({ evidenceType: "url", title: "UAT report" }).success).toBe(false);
    expect(evidenceCreateSchema.safeParse({ evidenceType: "note", title: "Sign-off", note: "Approved in the steering meeting." }).success).toBe(true);
    expect(evidenceCreateSchema.safeParse({ evidenceType: "note", title: "Sign-off" }).success).toBe(false);
    expect(evidenceCreateSchema.safeParse({ evidenceType: "note", title: "Sign-off", note: "x", url: "https://example.com" }).success).toBe(false);
    expect(evidenceCreateSchema.safeParse({ evidenceType: "artifact", title: "HLD", artifactId }).success).toBe(true);
    expect(evidenceCreateSchema.safeParse({ evidenceType: "artifact", title: "HLD" }).success).toBe(false);
    expect(evidenceCreateSchema.safeParse({ evidenceType: "note", title: "HLD", note: "x", artifactId }).success).toBe(false);
    expect(evidenceCreateSchema.safeParse({ evidenceType: "upload", title: "File", note: "x" }).success).toBe(false);
  });
});
