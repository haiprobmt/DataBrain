/**
 * Project lifecycle domain: enums, the built-in template, and the pure rules (transitions, readiness, progress,
 * risk score, overdue). No database access here — services load the facts and call these functions, so every rule
 * can be unit-tested and the UI and the server share one source of truth.
 */

// ── Enums ───────────────────────────────────────────────────────────────────
export const LIFECYCLE_STATUSES = ["not_started", "active", "on_hold", "completed", "archived"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const STAGE_STATUSES = ["not_started", "in_progress", "blocked", "pending_approval", "completed", "skipped"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const CHECKLIST_STATUSES = ["pending", "in_progress", "completed", "waived"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const CHECKLIST_ITEM_TYPES = ["task", "deliverable", "evidence", "review"] as const;
export type ChecklistItemType = (typeof CHECKLIST_ITEM_TYPES)[number];

export const APPROVAL_STATUSES = ["requested", "approved", "rejected", "withdrawn"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const MILESTONE_STATUSES = ["planned", "in_progress", "completed", "at_risk", "cancelled"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const RISK_STATUSES = ["open", "mitigating", "accepted", "resolved", "closed"] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export const RISK_CATEGORIES = ["business", "delivery", "data", "architecture", "security", "vendor", "operational", "other"] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const EVIDENCE_TYPES = ["artifact", "url", "note"] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const READINESS_RULES = [
  "required_checklist_complete",
  "requirements_approved",
  "blueprint_approved",
  "deployment_dry_run_succeeded",
  "required_evidence_present",
  "stage_approval_recorded",
] as const;
export type ReadinessRule = (typeof READINESS_RULES)[number];

export const READINESS_RULE_LABELS: Record<ReadinessRule, { label: string; help: string }> = {
  required_checklist_complete: { label: "Required checklist complete", help: "Every required checklist item is completed, or waived with a recorded reason." },
  requirements_approved: { label: "Requirements approved", help: "The project requirements are approved in Requirements & Finder." },
  blueprint_approved: { label: "Blueprint approved", help: "The project has an approved Solution Blueprint revision." },
  deployment_dry_run_succeeded: { label: "Dry-run succeeded", help: "The current deployment plan has a successful dry-run in Deployment Studio." },
  required_evidence_present: { label: "Required evidence attached", help: "Every required checklist item of type “evidence” has at least one evidence record linked to it." },
  stage_approval_recorded: { label: "Stage approval recorded", help: "The assigned reviewer, or a workspace owner, approved the stage gate." },
};

const title = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
export const statusLabel = (status: string) => title(status);
export const LIFECYCLE_NOT_STARTED_LABEL = "Lifecycle not started";

// ── Built-in template ───────────────────────────────────────────────────────
export interface TemplateChecklistDef {
  title: string;
  description?: string;
  itemType: ChecklistItemType;
  isRequired: boolean;
}

export interface TemplateStageDef {
  stageKey: string;
  name: string;
  description: string;
  isRequired: boolean;
  requiresApproval: boolean;
  defaultDurationDays: number | null;
  readinessRules: ReadinessRule[];
  checklist: TemplateChecklistDef[];
}

export interface TemplateDef {
  name: string;
  description: string;
  stages: TemplateStageDef[];
}

const item = (text: string, itemType: ChecklistItemType = "task", isRequired = true): TemplateChecklistDef => ({ title: text, itemType, isRequired });
const gate = (...rules: ReadinessRule[]): ReadinessRule[] => ["required_checklist_complete", ...rules, "stage_approval_recorded"];

export const DEFAULT_TEMPLATE_NAME = "Data & AI Project Lifecycle";

/** The single source of truth for the default eight-stage lifecycle. Seeded per workspace; never read by the UI directly. */
export const DEFAULT_LIFECYCLE_TEMPLATE: TemplateDef = {
  name: DEFAULT_TEMPLATE_NAME,
  description: "Eight-stage delivery lifecycle for data and AI projects, from intake to operation and retirement. Each stage has a checklist and an approval gate.",
  stages: [
    {
      stageKey: "initiate",
      name: "Initiate",
      description: "Intake, business case, sponsor, scope, objectives, success measures and initial risks.",
      isRequired: true,
      requiresApproval: true,
      defaultDurationDays: 10,
      readinessRules: gate(),
      checklist: [
        item("Business problem and objectives documented.", "deliverable"),
        item("Sponsor and business owner identified."),
        item("Scope, exclusions, and success measures documented.", "deliverable"),
        item("Initial stakeholders and dependencies identified."),
        item("Initial risks recorded."),
      ],
    },
    {
      stageKey: "discover",
      name: "Discover",
      description: "Requirements, source inventory, KPI definitions, current-state assessment and feasibility.",
      isRequired: true,
      requiresApproval: true,
      defaultDurationDays: 20,
      readinessRules: gate("requirements_approved"),
      checklist: [
        item("Business requirements documented and reviewed.", "review"),
        item("Source systems and data owners identified."),
        item("KPI/business definitions captured.", "deliverable"),
        item("Data availability and known data-quality constraints assessed."),
        item("Non-functional requirements captured.", "deliverable"),
        item("Requirements approved in DataBrain.", "review"),
      ],
    },
    {
      stageKey: "design",
      name: "Design",
      description: "Architecture, data model, integration design, security, governance and decision records.",
      isRequired: true,
      requiresApproval: true,
      defaultDurationDays: 20,
      readinessRules: gate("blueprint_approved"),
      checklist: [
        item("Architecture candidate selected and rationale recorded."),
        item("Solution blueprint completed.", "deliverable"),
        item("Security, identity, and network design reviewed.", "review"),
        item("Data model and integration design documented.", "deliverable"),
        item("Key ADRs recorded.", "deliverable"),
        item("Blueprint approved in DataBrain.", "review"),
      ],
    },
    {
      stageKey: "build",
      name: "Build",
      description: "Engineering implementation: pipelines, transformations, models, reports and documentation.",
      isRequired: true,
      requiresApproval: true,
      defaultDurationDays: 40,
      readinessRules: gate(),
      checklist: [
        item("Engineering backlog and ownership agreed."),
        item("Ingestion and transformation implementation completed or linked to its delivery tracker."),
        item("Data model / semantic model / reporting implementation documented as applicable.", "deliverable"),
        item("Code or artifact references recorded.", "evidence"),
        item("Technical peer review completed.", "review"),
        item("Engineering documentation updated.", "deliverable"),
      ],
    },
    {
      stageKey: "validate",
      name: "Validate",
      description: "Data validation, reconciliation evidence, SIT/UAT coordination, performance and security checks.",
      isRequired: true,
      requiresApproval: true,
      defaultDurationDays: 15,
      readinessRules: gate(),
      checklist: [
        item("Test approach and acceptance criteria documented.", "deliverable"),
        item("Source-to-target or business reconciliation evidence attached where applicable.", "evidence"),
        item("Data-quality validation evidence attached where applicable.", "evidence"),
        item("Performance and security testing evidence attached where applicable.", "evidence"),
        item("Defects and exceptions reviewed.", "review"),
        item("Business/UAT sign-off recorded.", "review"),
      ],
    },
    {
      stageKey: "release",
      name: "Release",
      description: "Deployment readiness, change approval, cutover, rollback and production handover.",
      isRequired: true,
      requiresApproval: true,
      defaultDurationDays: 10,
      readinessRules: gate("deployment_dry_run_succeeded"),
      checklist: [
        item("Deployment package and release notes prepared.", "deliverable"),
        item("Target environment and release window confirmed."),
        item("Dry-run / pre-deployment checks reviewed.", "review"),
        item("Change approval recorded.", "review"),
        item("Cutover and rollback plan reviewed.", "review"),
        item("Operational handover accepted.", "review"),
      ],
    },
    {
      stageKey: "operate",
      name: "Operate",
      description: "Operational ownership, support model, runbooks, monitoring handover and service review.",
      isRequired: true,
      requiresApproval: true,
      defaultDurationDays: null,
      readinessRules: gate(),
      checklist: [
        item("Service owner and support contacts confirmed."),
        item("Runbook and support procedure available.", "deliverable"),
        item("Monitoring and alerting ownership documented (references only in Phase 1)."),
        item("SLA / service expectations documented.", "deliverable"),
        item("Knowledge transfer completed."),
        item("Post-release review completed.", "review"),
      ],
    },
    {
      stageKey: "improve_retire",
      name: "Improve & Retire",
      description: "Continuous improvement, modernization, migration, archive, retention and decommissioning. Optional: a project may stay in Operate for its lifetime.",
      isRequired: false,
      requiresApproval: true,
      defaultDurationDays: null,
      readinessRules: gate(),
      checklist: [
        item("Improvement or retirement rationale documented.", "deliverable"),
        item("Downstream dependencies and consumers assessed."),
        item("Data retention and archival requirements reviewed.", "review"),
        item("Stakeholders notified and migration/cutover plan agreed."),
        item("Decommissioning approval recorded.", "review"),
        item("Final evidence and lessons learned stored.", "evidence"),
      ],
    },
  ],
};

// ── Links from a stage to the existing DataBrain modules ────────────────────
export interface StageLink {
  label: string;
  /** Path below `/projects/:projectId`; empty string is the project overview. */
  path: string;
  /** What the lifecycle reads from that module, if anything. */
  uses: string;
}

/** Which DataBrain module does the work of each built-in stage. Stages of custom templates with other keys have no links. */
export const STAGE_LINKS: Record<string, StageLink[]> = {
  initiate: [{ label: "Project brief", path: "/requirements", uses: "Project name, description and context" }],
  discover: [{ label: "Requirements & Finder", path: "/requirements", uses: "Requirements and their approval status" }],
  design: [{ label: "Solution Blueprint", path: "/blueprint", uses: "Approved architecture revision" }],
  build: [
    { label: "Artifact Factory", path: "/artifacts", uses: "Generated artifacts and their versions" },
    { label: "AI Skill Factory", path: "/skills", uses: "Skill packages" },
  ],
  validate: [],
  release: [{ label: "Deployment Studio", path: "/deployments", uses: "Deployment plan and its dry-run (simulated)" }],
  operate: [],
  improve_retire: [],
};

// ── Stage transitions ───────────────────────────────────────────────────────
export const STAGE_TRANSITIONS: Record<StageStatus, StageStatus[]> = {
  not_started: ["in_progress", "skipped"],
  in_progress: ["blocked", "pending_approval", "completed", "skipped"],
  blocked: ["in_progress"],
  pending_approval: ["in_progress", "completed"],
  completed: ["in_progress"],
  skipped: ["in_progress"],
};

export const canTransitionStage = (from: StageStatus, to: StageStatus): boolean => STAGE_TRANSITIONS[from].includes(to);

/** A stage is done for ordering and progress when it is completed, or was explicitly skipped. */
export const isStageDone = (status: StageStatus): boolean => status === "completed" || status === "skipped";

export interface StageOrderInput {
  id: string;
  name: string;
  sortOrder: number;
  isRequired: boolean;
  status: StageStatus;
}

/**
 * May work begin on this stage? A required stage needs every earlier required stage completed or skipped.
 * An optional stage only needs the project to have reached the required stage before it — so Improve & Retire can
 * start while Operate is still running, and never holds Operate back.
 */
export function stageStartCheck(stages: StageOrderInput[], stageId: string): { allowed: boolean; reason: string | null } {
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return { allowed: false, reason: "Stage not found." };
  const earlierRequired = stages.filter((s) => s.isRequired && s.sortOrder < stage.sortOrder).sort((a, b) => a.sortOrder - b.sortOrder);
  if (stage.isRequired) {
    const open = earlierRequired.filter((s) => !isStageDone(s.status));
    if (open.length) return { allowed: false, reason: `Complete or skip ${open.map((s) => `“${s.name}”`).join(", ")} first.` };
    return { allowed: true, reason: null };
  }
  const previous = earlierRequired[earlierRequired.length - 1];
  if (previous && previous.status === "not_started") return { allowed: false, reason: `This optional stage can start once the project reaches “${previous.name}”.` };
  const open = earlierRequired.slice(0, -1).filter((s) => !isStageDone(s.status));
  if (open.length) return { allowed: false, reason: `Complete or skip ${open.map((s) => `“${s.name}”`).join(", ")} first.` };
  return { allowed: true, reason: null };
}

export const LIFECYCLE_TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  not_started: ["active"],
  active: ["on_hold", "completed", "archived"],
  on_hold: ["active", "archived"],
  completed: ["active", "archived"],
  archived: ["active"],
};

export const canTransitionLifecycle = (from: LifecycleStatus, to: LifecycleStatus): boolean => LIFECYCLE_TRANSITIONS[from].includes(to);

// ── Checklist ───────────────────────────────────────────────────────────────
export interface ChecklistFact {
  id: string;
  title: string;
  isRequired: boolean;
  itemType: ChecklistItemType;
  status: ChecklistStatus;
  waivedReason?: string | null;
}

/**
 * Waiver policy: a waived item satisfies the checklist only when a reason was recorded with it.
 * It stays visible as waived — it is never counted as completed.
 */
export const isChecklistItemSatisfied = (i: Pick<ChecklistFact, "status" | "waivedReason">): boolean =>
  i.status === "completed" || (i.status === "waived" && !!i.waivedReason?.trim());

export const outstandingRequiredItems = <T extends ChecklistFact>(items: T[]): T[] => items.filter((i) => i.isRequired && !isChecklistItemSatisfied(i));

// ── Readiness ───────────────────────────────────────────────────────────────
export type BlockerCode =
  | "required_checklist_incomplete"
  | "requirements_not_started"
  | "requirements_not_approved"
  | "blueprint_missing"
  | "blueprint_not_approved"
  | "deployment_plan_missing"
  | "deployment_dry_run_missing"
  | "required_evidence_missing"
  | "stage_approval_missing"
  | "stage_approval_pending"
  | "stage_approval_rejected";

export interface Blocker {
  code: BlockerCode;
  rule: ReadinessRule;
  message: string;
  /** Path below `/projects/:projectId` where the blocker is resolved; null when it is resolved on the stage itself. */
  path: string | null;
  /** Checklist item IDs behind this blocker, when it is about the checklist or its evidence. */
  itemIds?: string[];
}

/** Server-side facts the evaluator reads. Nothing here comes from the client. */
export interface ReadinessFacts {
  stageName: string;
  checklist: ChecklistFact[];
  /** IDs of checklist items that have at least one evidence record that was not superseded. */
  itemsWithEvidence: string[];
  requirementsStatus: "none" | "draft" | "approved";
  blueprint: { exists: boolean; approved: boolean };
  deployment: { planExists: boolean; dryRunSucceeded: boolean };
  /** Status of the newest approval that was not invalidated, or null when none was ever requested. */
  latestApproval: ApprovalStatus | null;
}

export interface ReadinessResult {
  ready: boolean;
  blockers: Blocker[];
  /** One entry per evaluated rule, in rule order, for display. */
  rules: { rule: ReadinessRule; passed: boolean }[];
}

/**
 * Evaluate a stage gate. `gate: "request"` checks everything that must hold before approval can be requested or
 * granted (all rules except the approval itself); `gate: "complete"` also requires the recorded approval.
 */
export function evaluateReadiness(rules: ReadinessRule[], facts: ReadinessFacts, gate: "request" | "complete" = "complete"): ReadinessResult {
  const blockers: Blocker[] = [];
  const results: { rule: ReadinessRule; passed: boolean }[] = [];
  const ordered = READINESS_RULES.filter((r) => rules.includes(r) && (gate === "complete" || r !== "stage_approval_recorded"));

  for (const rule of ordered) {
    const before = blockers.length;
    switch (rule) {
      case "required_checklist_complete": {
        const open = outstandingRequiredItems(facts.checklist);
        if (open.length) {
          blockers.push({
            code: "required_checklist_incomplete",
            rule,
            message: `${open.length} required checklist item${open.length === 1 ? " is" : "s are"} still open in ${facts.stageName}: ${open.slice(0, 3).map((i) => i.title).join(" · ")}${open.length > 3 ? ` · and ${open.length - 3} more` : ""}`,
            path: null,
            itemIds: open.map((i) => i.id),
          });
        }
        break;
      }
      case "requirements_approved":
        if (facts.requirementsStatus === "none") blockers.push({ code: "requirements_not_started", rule, message: `Record and approve the project requirements before completing ${facts.stageName}. No requirements have been recorded yet.`, path: "/requirements" });
        else if (facts.requirementsStatus !== "approved") blockers.push({ code: "requirements_not_approved", rule, message: `Approve the project requirements before completing ${facts.stageName}.`, path: "/requirements" });
        break;
      case "blueprint_approved":
        if (!facts.blueprint.exists) blockers.push({ code: "blueprint_missing", rule, message: `Create and approve a Solution Blueprint before completing ${facts.stageName}. This project has no blueprint yet.`, path: "/blueprint" });
        else if (!facts.blueprint.approved) blockers.push({ code: "blueprint_not_approved", rule, message: `Approve the Solution Blueprint before completing ${facts.stageName}.`, path: "/blueprint" });
        break;
      case "deployment_dry_run_succeeded":
        if (!facts.deployment.planExists) blockers.push({ code: "deployment_plan_missing", rule, message: `Create a deployment plan and run its dry-run before completing ${facts.stageName}. This project has no current deployment plan.`, path: "/deployments" });
        else if (!facts.deployment.dryRunSucceeded) blockers.push({ code: "deployment_dry_run_missing", rule, message: `Run a successful dry-run of the current deployment plan before completing ${facts.stageName}.`, path: "/deployments" });
        break;
      case "required_evidence_present": {
        const withEvidence = new Set(facts.itemsWithEvidence);
        const missing = facts.checklist.filter((i) => i.isRequired && i.itemType === "evidence" && i.status !== "waived" && !withEvidence.has(i.id));
        if (missing.length) {
          blockers.push({
            code: "required_evidence_missing",
            rule,
            message: `Attach evidence to ${missing.length} required evidence item${missing.length === 1 ? "" : "s"} in ${facts.stageName}: ${missing.slice(0, 3).map((i) => i.title).join(" · ")}${missing.length > 3 ? ` · and ${missing.length - 3} more` : ""}`,
            path: null,
            itemIds: missing.map((i) => i.id),
          });
        }
        break;
      }
      case "stage_approval_recorded":
        if (facts.latestApproval === "requested") blockers.push({ code: "stage_approval_pending", rule, message: `The approval request for ${facts.stageName} is waiting for its reviewer.`, path: null });
        else if (facts.latestApproval === "rejected") blockers.push({ code: "stage_approval_rejected", rule, message: `The last approval request for ${facts.stageName} was rejected. Address the feedback and request approval again.`, path: null });
        else if (facts.latestApproval !== "approved") blockers.push({ code: "stage_approval_missing", rule, message: `${facts.stageName} needs an approval. Request approval once the other conditions are met.`, path: null });
        break;
    }
    results.push({ rule, passed: blockers.length === before });
  }
  return { ready: blockers.length === 0, blockers, rules: results };
}

/** Keep `requiresApproval` and the approval rule in step, drop duplicates, and return the rules in canonical order. */
export function normalizeReadinessRules(rules: readonly ReadinessRule[], requiresApproval: boolean): ReadinessRule[] {
  const set = new Set(rules);
  if (requiresApproval) set.add("stage_approval_recorded");
  else set.delete("stage_approval_recorded");
  return READINESS_RULES.filter((r) => set.has(r));
}

// ── Dates ───────────────────────────────────────────────────────────────────
const startOfUtcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** A due date is overdue once its whole (UTC) day has passed and the work is not done. */
export function isOverdue(dueAt: Date | string | null | undefined, done: boolean, now: Date): boolean {
  if (!dueAt || done) return false;
  const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  return startOfUtcDay(due) < startOfUtcDay(now);
}

export const MILESTONE_DONE: MilestoneStatus[] = ["completed", "cancelled"];
export const isMilestoneOpen = (status: MilestoneStatus) => !MILESTONE_DONE.includes(status);

// ── Progress ────────────────────────────────────────────────────────────────
export interface StageProgressInput extends StageOrderInput {
  stageKey: string;
  dueAt: Date | string | null;
}

export interface LifecycleProgress {
  /** Completed-or-skipped required stages ÷ required stages. Stage completion only: not effort, quality or value. */
  percent: number;
  requiredStages: number;
  requiredStagesDone: number;
  skippedStages: number;
  /** The earliest required stage that is not done; or a started optional stage once every required stage is done. */
  currentStageId: string | null;
  blockedStageIds: string[];
  pendingApprovalStageIds: string[];
  overdueStageIds: string[];
  checklist: { total: number; satisfied: number; outstandingRequired: number };
}

export function computeProgress(stages: StageProgressInput[], checklist: (ChecklistFact & { stageId: string })[], now: Date): LifecycleProgress {
  const ordered = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);
  const required = ordered.filter((s) => s.isRequired);
  const done = required.filter((s) => isStageDone(s.status));
  const current = required.find((s) => !isStageDone(s.status)) ?? ordered.find((s) => !s.isRequired && s.status !== "not_started" && !isStageDone(s.status)) ?? null;
  return {
    percent: required.length ? Math.round((done.length / required.length) * 100) : 0,
    requiredStages: required.length,
    requiredStagesDone: done.length,
    skippedStages: ordered.filter((s) => s.status === "skipped").length,
    currentStageId: current?.id ?? null,
    blockedStageIds: ordered.filter((s) => s.status === "blocked").map((s) => s.id),
    pendingApprovalStageIds: ordered.filter((s) => s.status === "pending_approval").map((s) => s.id),
    overdueStageIds: ordered.filter((s) => s.status !== "not_started" && isOverdue(s.dueAt, isStageDone(s.status), now)).map((s) => s.id),
    checklist: {
      total: checklist.length,
      satisfied: checklist.filter(isChecklistItemSatisfied).length,
      outstandingRequired: outstandingRequiredItems(checklist).length,
    },
  };
}

// ── Risk ────────────────────────────────────────────────────────────────────
export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Likelihood × impact on 1–5 scales. A ranking aid for a register, not a probability or a forecast. */
export function riskScore(likelihood: number, impact: number): number {
  for (const [name, value] of [["Likelihood", likelihood], ["Impact", impact]] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 5) throw new RangeError(`${name} must be a whole number from 1 to 5.`);
  }
  return likelihood * impact;
}

export function riskLevel(score: number): RiskLevel {
  if (score >= 16) return "critical";
  if (score >= 10) return "high";
  if (score >= 5) return "medium";
  return "low";
}

/** A risk still needs attention while it is open or being mitigated. Accepted, resolved and closed risks are decided. */
export const OPEN_RISK_STATUSES: RiskStatus[] = ["open", "mitigating"];
export const isRiskOpen = (status: RiskStatus) => OPEN_RISK_STATUSES.includes(status);
export const isHighRisk = (likelihood: number, impact: number) => riskScore(likelihood, impact) >= 10;

// ── Evidence URLs ───────────────────────────────────────────────────────────
export const EVIDENCE_URL_MAX = 2000;

/** Only absolute http(s) links without embedded credentials are accepted as evidence. */
export function evidenceUrlProblem(value: string): string | null {
  const raw = value.trim();
  if (!raw) return "Enter a URL.";
  if (raw.length > EVIDENCE_URL_MAX) return `URLs are limited to ${EVIDENCE_URL_MAX} characters.`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a full URL, including https://";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Only http:// and https:// links can be stored as evidence.";
  if (url.username || url.password) return "Remove the user name and password from the URL.";
  return null;
}
