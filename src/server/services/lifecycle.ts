import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  canTransitionLifecycle,
  canTransitionStage,
  computeProgress,
  evaluateReadiness,
  evidenceUrlProblem,
  isMilestoneOpen,
  isOverdue,
  isRiskOpen,
  isStageDone,
  riskLevel,
  riskScore,
  stageStartCheck,
  statusLabel,
  type ApprovalStatus,
  type Blocker,
  type ChecklistItemType,
  type ChecklistStatus,
  type EvidenceType,
  type LifecycleProgress,
  type LifecycleStatus,
  type MilestoneStatus,
  type ReadinessFacts,
  type ReadinessResult,
  type ReadinessRule,
  type RiskCategory,
  type RiskLevel,
  type RiskStatus,
  type StageStatus,
} from "@/lib/lifecycle";
import type { ChecklistCreateInput, ChecklistUpdateInput, EvidenceCreateInput, MilestoneCreateInput, MilestoneUpdateInput, RiskCreateInput, RiskUpdateInput, StageUpdateInput } from "@/lib/lifecycle-schemas";
import { audit } from "../audit";
import { assertCanEdit, type Ctx } from "../ctx";
import { getDb, schema, type Tx } from "../db";
import { AppError, conflict, forbidden, notFound, precondition } from "../errors";
import { loadTemplateStages, resolveTemplateForStart } from "./lifecycle-templates";
import { getProject, type Project } from "./projects";

const lc = schema.projectLifecycles;
const st = schema.projectStageInstances;
const ci = schema.projectChecklistItems;
const ap = schema.stageApprovals;
const ev = schema.stageEvidence;
const ms = schema.projectMilestones;
const rk = schema.projectRisks;

type Lifecycle = typeof lc.$inferSelect;
type Stage = typeof st.$inferSelect;
type ChecklistItem = typeof ci.$inferSelect;
type Approval = typeof ap.$inferSelect;
type Evidence = typeof ev.$inferSelect;
type Milestone = typeof ms.$inferSelect;
type Risk = typeof rk.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const clip = (text: string, max = 300) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// ── Views (JSON-safe: dates are ISO strings) ────────────────────────────────
export interface UserRef {
  id: string;
  name: string;
}

export interface Member extends UserRef {
  email: string;
  role: "owner" | "editor" | "viewer";
}

export interface ChecklistItemView {
  id: string;
  title: string;
  description: string;
  sortOrder: number;
  isRequired: boolean;
  itemType: ChecklistItemType;
  origin: "template" | "custom";
  status: ChecklistStatus;
  assignee: UserRef | null;
  dueAt: string | null;
  overdue: boolean;
  completedAt: string | null;
  completedBy: UserRef | null;
  notes: string;
  waivedReason: string | null;
  statusChangedAt: string | null;
  statusChangedBy: UserRef | null;
  evidenceCount: number;
}

export interface EvidenceView {
  id: string;
  title: string;
  evidenceType: EvidenceType;
  url: string | null;
  note: string | null;
  checklistItemId: string | null;
  artifact: { id: string; name: string; path: string; version: number | null } | null;
  createdBy: UserRef | null;
  createdAt: string;
  superseded: { at: string; by: UserRef | null; reason: string } | null;
}

export interface ApprovalView {
  id: string;
  status: ApprovalStatus;
  requestedBy: UserRef | null;
  reviewer: UserRef | null;
  requestNote: string;
  decisionNote: string | null;
  decidedBy: UserRef | null;
  requestedAt: string;
  decidedAt: string | null;
  /** Set when an approved gate was voided because its stage, or an earlier one, was reopened. */
  invalidated: { at: string; reason: string } | null;
}

export interface StageView {
  id: string;
  stageKey: string;
  name: string;
  description: string;
  sortOrder: number;
  isRequired: boolean;
  requiresApproval: boolean;
  defaultDurationDays: number | null;
  readinessRules: ReadinessRule[];
  status: StageStatus;
  owner: UserRef | null;
  reviewer: UserRef | null;
  startAt: string | null;
  dueAt: string | null;
  overdue: boolean;
  completedAt: string | null;
  notes: string;
  blockedReason: string | null;
  completionNote: string | null;
  skipReason: string | null;
  /** Whether work may begin (or resume) on this stage, and if not, why. */
  start: { allowed: boolean; reason: string | null };
  /** Gate conditions other than the approval itself: what must hold before approval is requested or granted. */
  readiness: ReadinessResult;
  checklist: ChecklistItemView[];
  evidence: EvidenceView[];
  approvals: ApprovalView[];
}

/** What the readiness evaluator read from the existing DataBrain modules. */
export interface DeliveryFacts {
  requirementsStatus: "none" | "draft" | "approved";
  blueprint: { exists: boolean; approved: boolean; approvedVersion: number | null };
  deployment: { planExists: boolean; dryRunSucceeded: boolean; simulated: boolean };
  artifactCount: number;
}

export interface LifecycleView {
  project: { id: string; name: string; status: "active" | "archived" };
  lifecycle: null | {
    id: string;
    status: LifecycleStatus;
    templateId: string;
    templateName: string;
    templateVersion: number;
    startedAt: string | null;
    targetEndAt: string | null;
    completedAt: string | null;
  };
  stages: StageView[];
  /** Derived from the stage and checklist rows on every read; never stored or editable. */
  progress: LifecycleProgress | null;
  facts: DeliveryFacts;
}

export interface MilestoneView {
  id: string;
  name: string;
  description: string;
  status: MilestoneStatus;
  owner: UserRef | null;
  dueAt: string | null;
  overdue: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RiskView {
  id: string;
  title: string;
  description: string;
  category: RiskCategory;
  likelihood: number;
  impact: number;
  /** likelihood × impact, computed on the server. */
  score: number;
  level: RiskLevel;
  status: RiskStatus;
  owner: UserRef | null;
  mitigation: string;
  dueAt: string | null;
  overdue: boolean;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Members ─────────────────────────────────────────────────────────────────
export async function listMembers(ctx: Ctx): Promise<Member[]> {
  return getDb()
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.workspaceId, ctx.workspaceId))
    .orderBy(asc(schema.users.name));
}

/** A user ID sent by a client is only accepted when that user is a member of the caller's workspace. */
async function requireMember(ctx: Ctx, userId: string, field: string, options: { canDecide?: boolean } = {}): Promise<Member> {
  const [member] = await getDb()
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, userId)))
    .limit(1);
  if (!member) throw new AppError("validation_error", "That person is not a member of this workspace.", { [field]: ["Choose a member of this workspace."] });
  if (options.canDecide && member.role === "viewer") throw new AppError("validation_error", "A viewer cannot review a stage gate.", { [field]: ["Choose an owner or editor as reviewer."] });
  return member;
}

async function userNames(ids: (string | null | undefined)[]): Promise<(id: string | null) => UserRef | null> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = unique.length ? await getDb().select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, unique)) : [];
  const map = new Map(rows.map((r) => [r.id, r]));
  return (id) => (id ? (map.get(id) ?? { id, name: "Former member" }) : null);
}

// ── Loading and scope checks ────────────────────────────────────────────────
async function findLifecycle(project: Project, tx: Tx = getDb()): Promise<Lifecycle | null> {
  const [lifecycle] = await tx.select().from(lc).where(and(eq(lc.projectId, project.id), eq(lc.workspaceId, project.workspaceId))).limit(1);
  return lifecycle ?? null;
}

async function requireLifecycle(ctx: Ctx, projectId: string): Promise<{ project: Project; lifecycle: Lifecycle }> {
  const project = await getProject(ctx, projectId);
  const lifecycle = await findLifecycle(project);
  if (!lifecycle) throw notFound("Project lifecycle");
  return { project, lifecycle };
}

/** Resolve project → lifecycle → stage, so a stage ID is never used without proving it belongs to the caller's project. */
async function requireStage(ctx: Ctx, projectId: string, stageId: string): Promise<{ project: Project; lifecycle: Lifecycle; stage: Stage; stages: Stage[] }> {
  const { project, lifecycle } = await requireLifecycle(ctx, projectId);
  if (!UUID.test(stageId)) throw notFound("Lifecycle stage");
  const stages = await getDb().select().from(st).where(and(eq(st.projectLifecycleId, lifecycle.id), eq(st.workspaceId, ctx.workspaceId))).orderBy(asc(st.sortOrder));
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) throw notFound("Lifecycle stage");
  return { project, lifecycle, stage, stages };
}

function assertLifecycleActive(lifecycle: Lifecycle): void {
  if (lifecycle.status !== "active") throw precondition(`This lifecycle is ${statusLabel(lifecycle.status).toLowerCase()}. Set it back to active to change its stages.`);
}

/** Checklist and evidence are frozen while a gate is under review and once the stage is closed. */
function assertStageOpen(stage: Stage): void {
  if (stage.status === "pending_approval") throw precondition(`“${stage.name}” is waiting for approval. Withdraw the request to make changes.`);
  if (isStageDone(stage.status)) throw precondition(`“${stage.name}” is ${statusLabel(stage.status).toLowerCase()}. Reopen the stage to make changes.`);
}

async function loadFacts(project: Project): Promise<DeliveryFacts> {
  const db = getDb();
  const rev = schema.architectureRevisions;
  const plans = schema.deploymentPlans;
  const runs = schema.deploymentRuns;
  const [[revisions], currentPlans, [artifactRow]] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int`, approvedVersion: sql<number | null>`max(${rev.version}) filter (where ${rev.status} = 'approved')` }).from(rev).where(eq(rev.projectId, project.id)),
    db.select({ id: plans.id, planHash: plans.planHash }).from(plans).where(and(eq(plans.projectId, project.id), eq(plans.status, "planned"))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.artifacts).where(eq(schema.artifacts.projectId, project.id)),
  ]);
  // A dry-run only counts for the plan as it stands now: same plan, same hash, finished successfully.
  const dryRuns = currentPlans.length
    ? await db.select({ planId: runs.planId, planHash: runs.planHash, simulated: runs.simulated }).from(runs).where(and(inArray(runs.planId, currentPlans.map((p) => p.id)), eq(runs.mode, "dry-run"), eq(runs.status, "succeeded")))
    : [];
  const matching = dryRuns.filter((r) => currentPlans.some((p) => p.id === r.planId && p.planHash === r.planHash));
  return {
    requirementsStatus: project.requirementsStatus,
    blueprint: { exists: (revisions?.total ?? 0) > 0, approved: revisions?.approvedVersion != null, approvedVersion: revisions?.approvedVersion ?? null },
    deployment: { planExists: currentPlans.length > 0, dryRunSucceeded: matching.length > 0, simulated: matching.length > 0 && matching.every((r) => r.simulated) },
    artifactCount: artifactRow?.n ?? 0,
  };
}

/** The newest approval that still stands (a voided approval no longer counts). */
const latestStanding = (approvals: Approval[]): Approval | null => [...approvals].filter((a) => !a.invalidatedAt).sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())[0] ?? null;

function readinessFacts(stage: Stage, items: ChecklistItem[], evidence: Evidence[], approvals: Approval[], facts: DeliveryFacts): ReadinessFacts {
  return {
    stageName: stage.name,
    checklist: items.map((i) => ({ id: i.id, title: i.title, isRequired: i.isRequired, itemType: i.itemType, status: i.status, waivedReason: i.waivedReason })),
    itemsWithEvidence: [...new Set(evidence.filter((e) => !e.supersededAt && e.checklistItemId).map((e) => e.checklistItemId!))],
    requirementsStatus: facts.requirementsStatus,
    blueprint: facts.blueprint,
    deployment: facts.deployment,
    latestApproval: latestStanding(approvals)?.status ?? null,
  };
}

async function stageGate(project: Project, stage: Stage, gate: "request" | "complete"): Promise<ReadinessResult> {
  const db = getDb();
  const [items, evidence, approvals, facts] = await Promise.all([
    db.select().from(ci).where(eq(ci.stageInstanceId, stage.id)),
    db.select().from(ev).where(eq(ev.stageInstanceId, stage.id)),
    db.select().from(ap).where(eq(ap.stageInstanceId, stage.id)),
    loadFacts(project),
  ]);
  return evaluateReadiness(stage.readinessRules, readinessFacts(stage, items, evidence, approvals, facts), gate);
}

function gateError(stage: Stage, action: string, blockers: Blocker[]): AppError {
  const more = blockers.length > 1 ? ` (and ${blockers.length - 1} more condition${blockers.length === 2 ? "" : "s"})` : "";
  return new AppError("precondition_failed", `${stage.name} cannot ${action} yet. ${blockers[0]!.message}${more}`, undefined, { blockers });
}

type AuditEntity = "project_lifecycle" | "lifecycle_stage" | "checklist_item" | "stage_evidence" | "stage_approval" | "project_milestone" | "project_risk";

/** Lifecycle audit events share the `lifecycle.` prefix and carry IDs and state changes only. */
function record(ctx: Ctx, tx: Tx, project: Project, action: string, entityType: AuditEntity, entityId: string, summary: string, metadata: Record<string, unknown> = {}) {
  return audit(ctx, { action: `lifecycle.${action}`, entityType, entityId, projectId: project.id, summary, metadata }, tx);
}

const stageMeta = (stage: Stage, extra: Record<string, unknown> = {}) => ({ stageId: stage.id, stageKey: stage.stageKey, ...extra });

// ── Read ────────────────────────────────────────────────────────────────────
export async function getProjectLifecycle(ctx: Ctx, projectId: string, now: Date = new Date()): Promise<LifecycleView> {
  const project = await getProject(ctx, projectId);
  const [lifecycle, facts] = await Promise.all([findLifecycle(project), loadFacts(project)]);
  const base = { project: { id: project.id, name: project.name, status: project.status }, facts };
  if (!lifecycle) return { ...base, lifecycle: null, stages: [], progress: null };

  const db = getDb();
  const stages = await db.select().from(st).where(and(eq(st.projectLifecycleId, lifecycle.id), eq(st.workspaceId, ctx.workspaceId))).orderBy(asc(st.sortOrder));
  const stageIds = stages.map((s) => s.id);
  const [items, evidence, approvals] = stageIds.length
    ? await Promise.all([
        db.select().from(ci).where(inArray(ci.stageInstanceId, stageIds)).orderBy(asc(ci.sortOrder)),
        db.select().from(ev).where(inArray(ev.stageInstanceId, stageIds)).orderBy(desc(ev.createdAt)),
        db.select().from(ap).where(inArray(ap.stageInstanceId, stageIds)).orderBy(desc(ap.requestedAt)),
      ])
    : [[], [], []];
  const artifactIds = [...new Set(evidence.map((e) => e.artifactId).filter((x): x is string => !!x))];
  const revisionIds = [...new Set(evidence.map((e) => e.artifactRevisionId).filter((x): x is string => !!x))];
  const [artifactRows, revisionRows, user] = await Promise.all([
    artifactIds.length ? db.select({ id: schema.artifacts.id, name: schema.artifacts.name, path: schema.artifacts.path }).from(schema.artifacts).where(inArray(schema.artifacts.id, artifactIds)) : [],
    revisionIds.length ? db.select({ id: schema.artifactRevisions.id, version: schema.artifactRevisions.version }).from(schema.artifactRevisions).where(inArray(schema.artifactRevisions.id, revisionIds)) : [],
    userNames([
      ...stages.flatMap((s) => [s.ownerId, s.reviewerId]),
      ...items.flatMap((i) => [i.assigneeId, i.completedBy, i.statusChangedBy]),
      ...evidence.flatMap((e) => [e.createdBy, e.supersededBy]),
      ...approvals.flatMap((a) => [a.requestedBy, a.reviewerId, a.decidedBy]),
    ]),
  ]);

  const order = stages.map((s) => ({ id: s.id, name: s.name, sortOrder: s.sortOrder, isRequired: s.isRequired, status: s.status }));
  const views: StageView[] = stages.map((stage) => {
    const stageItems = items.filter((i) => i.stageInstanceId === stage.id);
    const stageEvidence = evidence.filter((e) => e.stageInstanceId === stage.id);
    const stageApprovals = approvals.filter((a) => a.stageInstanceId === stage.id);
    const done = isStageDone(stage.status);
    return {
      id: stage.id,
      stageKey: stage.stageKey,
      name: stage.name,
      description: stage.description,
      sortOrder: stage.sortOrder,
      isRequired: stage.isRequired,
      requiresApproval: stage.requiresApproval,
      defaultDurationDays: stage.defaultDurationDays,
      readinessRules: stage.readinessRules,
      status: stage.status,
      owner: user(stage.ownerId),
      reviewer: user(stage.reviewerId),
      startAt: iso(stage.startAt),
      dueAt: iso(stage.dueAt),
      overdue: isOverdue(stage.dueAt, done, now),
      completedAt: iso(stage.completedAt),
      notes: stage.notes,
      blockedReason: stage.blockedReason,
      completionNote: stage.completionNote,
      skipReason: stage.skipReason,
      start: stageStartCheck(order, stage.id),
      readiness: evaluateReadiness(stage.readinessRules, readinessFacts(stage, stageItems, stageEvidence, stageApprovals, facts), "request"),
      checklist: stageItems.map((i) => ({
        id: i.id,
        title: i.title,
        description: i.description,
        sortOrder: i.sortOrder,
        isRequired: i.isRequired,
        itemType: i.itemType,
        origin: i.origin,
        status: i.status,
        assignee: user(i.assigneeId),
        dueAt: iso(i.dueAt),
        overdue: isOverdue(i.dueAt, i.status === "completed" || i.status === "waived" || done, now),
        completedAt: iso(i.completedAt),
        completedBy: user(i.completedBy),
        notes: i.notes,
        waivedReason: i.waivedReason,
        statusChangedAt: iso(i.statusChangedAt),
        statusChangedBy: user(i.statusChangedBy),
        evidenceCount: stageEvidence.filter((e) => e.checklistItemId === i.id && !e.supersededAt).length,
      })),
      evidence: stageEvidence.map((e) => {
        const artifact = artifactRows.find((a) => a.id === e.artifactId);
        return {
          id: e.id,
          title: e.title,
          evidenceType: e.evidenceType,
          url: e.url,
          note: e.note,
          checklistItemId: e.checklistItemId,
          artifact: artifact ? { ...artifact, version: revisionRows.find((r) => r.id === e.artifactRevisionId)?.version ?? null } : null,
          createdBy: user(e.createdBy),
          createdAt: e.createdAt.toISOString(),
          superseded: e.supersededAt ? { at: e.supersededAt.toISOString(), by: user(e.supersededBy), reason: e.supersededReason ?? "" } : null,
        };
      }),
      approvals: stageApprovals.map((a) => ({
        id: a.id,
        status: a.status,
        requestedBy: user(a.requestedBy),
        reviewer: user(a.reviewerId),
        requestNote: a.requestNote,
        decisionNote: a.decisionNote,
        decidedBy: user(a.decidedBy),
        requestedAt: a.requestedAt.toISOString(),
        decidedAt: iso(a.decidedAt),
        invalidated: a.invalidatedAt ? { at: a.invalidatedAt.toISOString(), reason: a.invalidatedReason ?? "" } : null,
      })),
    };
  });

  return {
    ...base,
    lifecycle: {
      id: lifecycle.id,
      status: lifecycle.status,
      templateId: lifecycle.templateId,
      templateName: lifecycle.templateName,
      templateVersion: lifecycle.templateVersion,
      startedAt: iso(lifecycle.startedAt),
      targetEndAt: iso(lifecycle.targetEndAt),
      completedAt: iso(lifecycle.completedAt),
    },
    stages: views,
    progress: computeProgress(
      stages.map((s) => ({ id: s.id, name: s.name, stageKey: s.stageKey, sortOrder: s.sortOrder, isRequired: s.isRequired, status: s.status, dueAt: s.dueAt })),
      items.map((i) => ({ id: i.id, stageId: i.stageInstanceId, title: i.title, isRequired: i.isRequired, itemType: i.itemType, status: i.status, waivedReason: i.waivedReason })),
      now,
    ),
  };
}

/** Audit events of one stage: its transitions, checklist, evidence and approvals. */
export async function stageActivity(ctx: Ctx, projectId: string, stageId: string, limit = 25) {
  const { project, stage } = await requireStage(ctx, projectId, stageId);
  const e = schema.auditEvents;
  return getDb()
    .select({ id: e.id, action: e.action, summary: e.summary, createdAt: e.createdAt, actor: schema.users.name })
    .from(e)
    .leftJoin(schema.users, eq(schema.users.id, e.actorId))
    .where(and(eq(e.workspaceId, ctx.workspaceId), eq(e.projectId, project.id), sql`${e.metadata}->>'stageId' = ${stage.id}`))
    .orderBy(desc(e.createdAt))
    .limit(limit);
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
/**
 * Start a project's lifecycle from a template. The stages and checklist are copied, so later template edits never
 * reach this project. Nothing is marked complete from existing project data: the first stage starts in progress
 * and everything else is not started. A project has one lifecycle; a second call is a conflict.
 */
export async function initializeProjectLifecycle(ctx: Ctx, projectId: string, templateId?: string): Promise<LifecycleView> {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const already = () => conflict(`“${project.name}” already has a lifecycle. Open it to continue.`);
  if (await findLifecycle(project)) throw already();
  const template = await resolveTemplateForStart(ctx, templateId);
  const definitions = await loadTemplateStages(template.id);
  if (!definitions.length) throw precondition(`“${template.name}” has no stages. Add stages to the template before using it.`);
  const first = definitions.find((d) => d.isRequired) ?? definitions[0]!;
  const now = new Date();

  await getDb().transaction(async (tx) => {
    const [lifecycle] = await tx
      .insert(lc)
      .values({ workspaceId: ctx.workspaceId, projectId: project.id, templateId: template.id, templateName: template.name, templateVersion: template.version, status: "active", startedAt: now, createdBy: ctx.userId })
      .onConflictDoNothing({ target: lc.projectId })
      .returning();
    if (!lifecycle) throw already();
    for (const def of definitions) {
      const isFirst = def.id === first.id;
      const [stage] = await tx
        .insert(st)
        .values({
          workspaceId: ctx.workspaceId,
          projectLifecycleId: lifecycle.id,
          stageDefinitionId: def.id,
          stageKey: def.stageKey,
          name: def.name,
          description: def.description,
          sortOrder: def.sortOrder,
          isRequired: def.isRequired,
          requiresApproval: def.requiresApproval,
          defaultDurationDays: def.defaultDurationDays,
          readinessRules: def.readinessRules,
          status: isFirst ? "in_progress" : "not_started",
          startAt: isFirst ? now : null,
        })
        .returning({ id: st.id });
      if (def.checklist.length) {
        await tx.insert(ci).values(def.checklist.map((c) => ({ workspaceId: ctx.workspaceId, stageInstanceId: stage!.id, definitionId: c.id, origin: "template" as const, title: c.title, description: c.description, sortOrder: c.sortOrder, isRequired: c.isRequired, itemType: c.itemType })));
      }
    }
    await record(ctx, tx, project, "initialize", "project_lifecycle", lifecycle.id, `Started the lifecycle from “${template.name}” v${template.version} (${definitions.length} stages)`, { templateId: template.id, templateVersion: template.version, stages: definitions.length });
  });
  return getProjectLifecycle(ctx, projectId);
}

export async function updateLifecycle(ctx: Ctx, projectId: string, input: { status?: Exclude<LifecycleStatus, "not_started">; targetEndAt?: Date | null; note?: string }): Promise<LifecycleView> {
  assertCanEdit(ctx);
  const { project, lifecycle } = await requireLifecycle(ctx, projectId);
  const patch: Partial<Lifecycle> = {};
  if (input.targetEndAt !== undefined) patch.targetEndAt = input.targetEndAt;
  const to = input.status;
  if (to && to !== lifecycle.status) {
    if (!canTransitionLifecycle(lifecycle.status, to)) throw precondition(`A lifecycle that is ${statusLabel(lifecycle.status).toLowerCase()} cannot be set to ${statusLabel(to).toLowerCase()}.`);
    if (to === "completed") {
      const stages = await getDb().select({ name: st.name, status: st.status, isRequired: st.isRequired }).from(st).where(eq(st.projectLifecycleId, lifecycle.id));
      const open = stages.filter((s) => s.isRequired && !isStageDone(s.status));
      if (open.length) throw precondition(`The lifecycle can be completed once every required stage is completed or skipped. Still open: ${open.map((s) => s.name).join(", ")}.`);
    }
    patch.status = to;
    patch.completedAt = to === "completed" ? new Date() : null;
  }
  await getDb().transaction(async (tx) => {
    await tx.update(lc).set(patch).where(eq(lc.id, lifecycle.id));
    if (patch.status) await record(ctx, tx, project, "status", "project_lifecycle", lifecycle.id, `Lifecycle set to ${statusLabel(patch.status).toLowerCase()}${input.note ? `: ${clip(input.note, 160)}` : ""}`, { from: lifecycle.status, to: patch.status });
    if (input.targetEndAt !== undefined && iso(input.targetEndAt) !== iso(lifecycle.targetEndAt)) await record(ctx, tx, project, "target-date", "project_lifecycle", lifecycle.id, input.targetEndAt ? `Target end date set to ${input.targetEndAt.toISOString().slice(0, 10)}` : "Target end date cleared", { from: iso(lifecycle.targetEndAt), to: iso(input.targetEndAt) });
  });
  return getProjectLifecycle(ctx, projectId);
}

// ── Stage transitions ───────────────────────────────────────────────────────
/** Move a stage with a compare-and-set on its current status, so two concurrent transitions cannot both win. */
async function moveStage(tx: Tx, stage: Stage, to: StageStatus, patch: Partial<Stage> = {}): Promise<Stage> {
  if (!canTransitionStage(stage.status, to)) throw precondition(`“${stage.name}” is ${statusLabel(stage.status).toLowerCase()} and cannot move to ${statusLabel(to).toLowerCase()}.`);
  const [moved] = await tx.update(st).set({ ...patch, status: to }).where(and(eq(st.id, stage.id), eq(st.status, stage.status))).returning();
  if (!moved) throw conflict(`“${stage.name}” was changed by someone else. Reload and try again.`);
  return moved;
}

const orderOf = (stages: Stage[]) => stages.map((s) => ({ id: s.id, name: s.name, sortOrder: s.sortOrder, isRequired: s.isRequired, status: s.status }));

/** Start a stage that has not begun, or resume one that was blocked. */
export async function startStage(ctx: Ctx, projectId: string, stageId: string): Promise<LifecycleView> {
  assertCanEdit(ctx);
  const { project, lifecycle, stage, stages } = await requireStage(ctx, projectId, stageId);
  assertLifecycleActive(lifecycle);
  if (stage.status !== "not_started" && stage.status !== "blocked") throw precondition(`“${stage.name}” is already ${statusLabel(stage.status).toLowerCase()}.`);
  const check = stageStartCheck(orderOf(stages), stage.id);
  if (!check.allowed) throw precondition(`“${stage.name}” cannot ${stage.status === "blocked" ? "resume" : "start"} yet. ${check.reason}`);
  await getDb().transaction(async (tx) => {
    const resumed = stage.status === "blocked";
    await moveStage(tx, stage, "in_progress", { startAt: stage.startAt ?? new Date(), blockedReason: null });
    await record(ctx, tx, project, resumed ? "stage.unblock" : "stage.start", "lifecycle_stage", stage.id, resumed ? `Resumed stage “${stage.name}”` : `Started stage “${stage.name}”`, stageMeta(stage, { from: stage.status, to: "in_progress" }));
  });
  return getProjectLifecycle(ctx, projectId);
}

export async function blockStage(ctx: Ctx, projectId: string, stageId: string, reason: string): Promise<LifecycleView> {
  assertCanEdit(ctx);
  const { project, lifecycle, stage } = await requireStage(ctx, projectId, stageId);
  assertLifecycleActive(lifecycle);
  if (!reason.trim()) throw new AppError("validation_error", "Say what is blocking the stage.", { reason: ["A reason is required."] });
  await getDb().transaction(async (tx) => {
    await moveStage(tx, stage, "blocked", { blockedReason: reason.trim() });
    await record(ctx, tx, project, "stage.block", "lifecycle_stage", stage.id, `Marked stage “${stage.name}” blocked: ${clip(reason.trim(), 160)}`, stageMeta(stage, { from: stage.status, to: "blocked" }));
  });
  return getProjectLifecycle(ctx, projectId);
}

/**
 * Complete a stage that has no approval gate. A stage that requires approval is completed by its approval, so this
 * reports the missing approval as a blocker instead of closing the stage.
 */
export async function completeStage(ctx: Ctx, projectId: string, stageId: string, completionNote?: string): Promise<LifecycleView> {
  assertCanEdit(ctx);
  const { project, lifecycle, stage } = await requireStage(ctx, projectId, stageId);
  assertLifecycleActive(lifecycle);
  if (stage.status !== "in_progress") throw precondition(`“${stage.name}” is ${statusLabel(stage.status).toLowerCase()}; only a stage in progress can be completed.`);
  const gate = await stageGate(project, stage, "complete");
  if (!gate.ready) throw gateError(stage, "be completed", gate.blockers);
  await getDb().transaction(async (tx) => {
    await moveStage(tx, stage, "completed", { completedAt: new Date(), completionNote: completionNote?.trim() || null, blockedReason: null });
    await record(ctx, tx, project, "stage.complete", "lifecycle_stage", stage.id, `Completed stage “${stage.name}”`, stageMeta(stage, { from: stage.status, to: "completed" }));
  });
  return getProjectLifecycle(ctx, projectId);
}

/** Skip a stage with a recorded reason. Skipping a required stage is an owner decision. */
export async function skipStage(ctx: Ctx, projectId: string, stageId: string, reason: string): Promise<LifecycleView> {
  assertCanEdit(ctx);
  const { project, lifecycle, stage, stages } = await requireStage(ctx, projectId, stageId);
  assertLifecycleActive(lifecycle);
  if (!reason.trim()) throw new AppError("validation_error", "Say why the stage is being skipped.", { reason: ["A reason is required."] });
  if (stage.isRequired && ctx.role !== "owner") throw forbidden("Only a workspace owner can skip a required stage.");
  const check = stageStartCheck(orderOf(stages), stage.id);
  if (!check.allowed) throw precondition(`“${stage.name}” cannot be skipped yet. ${check.reason}`);
  await getDb().transaction(async (tx) => {
    await moveStage(tx, stage, "skipped", { skipReason: reason.trim(), completedAt: null, blockedReason: null });
    await record(ctx, tx, project, "stage.skip", "lifecycle_stage", stage.id, `Skipped stage “${stage.name}”: ${clip(reason.trim(), 160)}`, stageMeta(stage, { from: stage.status, to: "skipped", required: stage.isRequired }));
  });
  return getProjectLifecycle(ctx, projectId);
}

/**
 * Reopen a completed or skipped stage for rework. Its own approval is voided, and every later stage that was
 * under way or closed is marked blocked with the reason and loses its approval — their checklists, evidence and
 * history are kept. They resume once this stage is completed again.
 */
export async function reopenStage(ctx: Ctx, projectId: string, stageId: string, reason: string): Promise<LifecycleView> {
  assertCanEdit(ctx);
  const { project, lifecycle, stage, stages } = await requireStage(ctx, projectId, stageId);
  if (lifecycle.status !== "active" && lifecycle.status !== "completed") assertLifecycleActive(lifecycle);
  if (!reason.trim()) throw new AppError("validation_error", "Say why the stage is being reopened.", { reason: ["A reason is required."] });
  if (!isStageDone(stage.status)) throw precondition(`“${stage.name}” is ${statusLabel(stage.status).toLowerCase()}; only a completed or skipped stage can be reopened.`);
  const now = new Date();
  const why = `Earlier stage “${stage.name}” was reopened: ${clip(reason.trim(), 200)}`;
  const later = stages.filter((s) => s.sortOrder > stage.sortOrder && (s.status === "in_progress" || s.status === "pending_approval" || s.status === "completed"));

  await getDb().transaction(async (tx) => {
    await moveStage(tx, stage, "in_progress", { completedAt: null, skipReason: null, completionNote: null });
    const voided = await tx
      .update(ap)
      .set({ invalidatedAt: now, invalidatedReason: `Stage reopened: ${clip(reason.trim(), 200)}` })
      .where(and(eq(ap.stageInstanceId, stage.id), eq(ap.status, "approved"), isNull(ap.invalidatedAt)))
      .returning({ id: ap.id });
    for (const dependent of later) {
      const [moved] = await tx.update(st).set({ status: "blocked", blockedReason: `${why} Review this stage once “${stage.name}” is completed again.`, completedAt: null }).where(and(eq(st.id, dependent.id), eq(st.status, dependent.status))).returning({ id: st.id });
      if (!moved) throw conflict(`“${dependent.name}” was changed by someone else. Reload and try again.`);
      await tx.update(ap).set({ status: "withdrawn", decidedAt: now, decidedBy: ctx.userId, decisionNote: `Withdrawn automatically. ${why}` }).where(and(eq(ap.stageInstanceId, dependent.id), eq(ap.status, "requested")));
      await tx.update(ap).set({ invalidatedAt: now, invalidatedReason: why }).where(and(eq(ap.stageInstanceId, dependent.id), eq(ap.status, "approved"), isNull(ap.invalidatedAt)));
      await record(ctx, tx, project, "stage.block", "lifecycle_stage", dependent.id, `Stage “${dependent.name}” needs review: “${stage.name}” was reopened`, stageMeta(dependent, { from: dependent.status, to: "blocked", cause: stage.id }));
    }
    if (lifecycle.status === "completed") await tx.update(lc).set({ status: "active", completedAt: null }).where(eq(lc.id, lifecycle.id));
    await record(ctx, tx, project, "stage.reopen", "lifecycle_stage", stage.id, `Reopened stage “${stage.name}”: ${clip(reason.trim(), 160)}`, stageMeta(stage, { from: stage.status, to: "in_progress", approvalsVoided: voided.length, stagesBlocked: later.map((s) => s.id) }));
  });
  return getProjectLifecycle(ctx, projectId);
}

/** Owner, reviewer, due date and notes — plus an optional status change, which goes through the same transition rules. */
export async function updateStage(ctx: Ctx, projectId: string, stageId: string, input: Omit<StageUpdateInput, "dueAt"> & { dueAt?: Date | null }): Promise<LifecycleView> {
  assertCanEdit(ctx);
  const { project, lifecycle, stage } = await requireStage(ctx, projectId, stageId);
  assertLifecycleActive(lifecycle);
  const owner = input.ownerId ? await requireMember(ctx, input.ownerId, "ownerId") : null;
  const reviewer = input.reviewerId ? await requireMember(ctx, input.reviewerId, "reviewerId", { canDecide: true }) : null;
  const patch: Partial<Stage> = {};
  const changes: string[] = [];
  const metadata: Record<string, unknown> = {};
  if (input.ownerId !== undefined && input.ownerId !== stage.ownerId) {
    patch.ownerId = input.ownerId;
    changes.push(owner ? `owner set to ${owner.name}` : "owner cleared");
    metadata.ownerId = { from: stage.ownerId, to: input.ownerId };
  }
  if (input.reviewerId !== undefined && input.reviewerId !== stage.reviewerId) {
    patch.reviewerId = input.reviewerId;
    changes.push(reviewer ? `reviewer set to ${reviewer.name}` : "reviewer cleared");
    metadata.reviewerId = { from: stage.reviewerId, to: input.reviewerId };
  }
  if (input.dueAt !== undefined && iso(input.dueAt) !== iso(stage.dueAt)) {
    patch.dueAt = input.dueAt;
    changes.push(input.dueAt ? `due date set to ${input.dueAt.toISOString().slice(0, 10)}` : "due date cleared");
    metadata.dueAt = { from: iso(stage.dueAt), to: iso(input.dueAt) };
  }
  if (input.notes !== undefined && input.notes !== stage.notes) {
    patch.notes = input.notes;
    changes.push("notes updated");
  }
  if (changes.length) {
    await getDb().transaction(async (tx) => {
      await tx.update(st).set(patch).where(eq(st.id, stage.id));
      await record(ctx, tx, project, "stage.update", "lifecycle_stage", stage.id, `Stage “${stage.name}”: ${changes.join(", ")}`, stageMeta(stage, metadata));
    });
  }
  if (input.status && input.status !== stage.status) {
    if (input.status === "in_progress") return startStage(ctx, projectId, stageId);
    if (input.status === "blocked") return blockStage(ctx, projectId, stageId, input.reason ?? "");
    if (input.status === "skipped") return skipStage(ctx, projectId, stageId, input.reason ?? "");
    return completeStage(ctx, projectId, stageId, input.reason);
  }
  return getProjectLifecycle(ctx, projectId);
}

// ── Checklist ───────────────────────────────────────────────────────────────
async function requireItem(stage: Stage, itemId: string): Promise<ChecklistItem> {
  if (!UUID.test(itemId)) throw notFound("Checklist item");
  const [item] = await getDb().select().from(ci).where(and(eq(ci.id, itemId), eq(ci.stageInstanceId, stage.id), eq(ci.workspaceId, stage.workspaceId))).limit(1);
  if (!item) throw notFound("Checklist item");
  return item;
}

export async function listChecklistItems(ctx: Ctx, projectId: string, stageId: string): Promise<ChecklistItemView[]> {
  await requireStage(ctx, projectId, stageId);
  const view = await getProjectLifecycle(ctx, projectId);
  return view.stages.find((s) => s.id === stageId)?.checklist ?? [];
}

export async function createChecklistItem(ctx: Ctx, projectId: string, stageId: string, input: Omit<ChecklistCreateInput, "dueAt"> & { dueAt?: Date | null }): Promise<{ id: string }> {
  assertCanEdit(ctx);
  const { project, lifecycle, stage } = await requireStage(ctx, projectId, stageId);
  assertLifecycleActive(lifecycle);
  assertStageOpen(stage);
  if (input.assigneeId) await requireMember(ctx, input.assigneeId, "assigneeId");
  return getDb().transaction(async (tx) => {
    const [last] = await tx.select({ n: sql<number>`coalesce(max(${ci.sortOrder}), 0)::int` }).from(ci).where(eq(ci.stageInstanceId, stage.id));
    const [item] = await tx
      .insert(ci)
      .values({ workspaceId: ctx.workspaceId, stageInstanceId: stage.id, origin: "custom", title: input.title, description: input.description, sortOrder: (last?.n ?? 0) + 1, isRequired: input.isRequired, itemType: input.itemType, assigneeId: input.assigneeId ?? null, dueAt: input.dueAt ?? null })
      .returning({ id: ci.id });
    await record(ctx, tx, project, "checklist.create", "checklist_item", item!.id, `Added ${input.isRequired ? "required" : "optional"} checklist item to “${stage.name}”: ${clip(input.title, 120)}`, stageMeta(stage, { itemId: item!.id, required: input.isRequired }));
    return item!;
  });
}

export async function updateChecklistItem(ctx: Ctx, projectId: string, stageId: string, itemId: string, input: Omit<ChecklistUpdateInput, "dueAt"> & { dueAt?: Date | null }): Promise<{ id: string; status: ChecklistStatus }> {
  assertCanEdit(ctx);
  const { project, lifecycle, stage } = await requireStage(ctx, projectId, stageId);
  assertLifecycleActive(lifecycle);
  assertStageOpen(stage);
  const item = await requireItem(stage, itemId);
  if (input.assigneeId) await requireMember(ctx, input.assigneeId, "assigneeId");
  const patch: Partial<ChecklistItem> = {};
  const changed: string[] = [];
  const set = (label: string, value: Partial<ChecklistItem>) => {
    Object.assign(patch, value);
    changed.push(label);
  };
  if (input.title !== undefined && input.title !== item.title) set("title", { title: input.title });
  if (input.description !== undefined && input.description !== item.description) set("description", { description: input.description });
  if (input.assigneeId !== undefined && input.assigneeId !== item.assigneeId) set("assignee", { assigneeId: input.assigneeId });
  if (input.dueAt !== undefined && iso(input.dueAt) !== iso(item.dueAt)) set("due date", { dueAt: input.dueAt });
  if (input.notes !== undefined && input.notes !== item.notes) set("notes", { notes: input.notes });

  let action = "checklist.update";
  let summary = `Updated checklist item in “${stage.name}” (${changed.join(", ")}): ${clip(item.title, 120)}`;
  const to = input.status;
  if (to && to !== item.status) {
    if (stage.status === "not_started") throw precondition(`Start “${stage.name}” before working through its checklist.`);
    const now = new Date();
    Object.assign(patch, { status: to, statusChangedBy: ctx.userId, statusChangedAt: now, waivedReason: null, completedAt: to === "completed" ? now : null, completedBy: to === "completed" ? ctx.userId : null });
    const wasSatisfied = item.status === "completed" || item.status === "waived";
    action = to === "completed" ? "checklist.complete" : wasSatisfied ? "checklist.reopen" : "checklist.update";
    summary = `${to === "completed" ? "Completed" : wasSatisfied ? `Reopened (was ${item.status})` : `Set to ${statusLabel(to).toLowerCase()}`} checklist item in “${stage.name}”: ${clip(item.title, 120)}`;
  } else if (!changed.length) {
    return { id: item.id, status: item.status };
  }
  await getDb().transaction(async (tx) => {
    await tx.update(ci).set(patch).where(eq(ci.id, item.id));
    await record(ctx, tx, project, action, "checklist_item", item.id, summary, stageMeta(stage, { itemId: item.id, changed, ...(patch.status ? { from: item.status, to: patch.status } : {}) }));
  });
  return { id: item.id, status: patch.status ?? item.status };
}

/** Waive an item with a mandatory reason. The item stays on the checklist, shown as waived, and the waiver is audited. */
export async function waiveChecklistItem(ctx: Ctx, projectId: string, stageId: string, itemId: string, reason: string): Promise<{ id: string; status: ChecklistStatus }> {
  assertCanEdit(ctx);
  const { project, lifecycle, stage } = await requireStage(ctx, projectId, stageId);
  assertLifecycleActive(lifecycle);
  assertStageOpen(stage);
  const item = await requireItem(stage, itemId);
  const text = reason.trim();
  if (!text) throw new AppError("validation_error", "Say why this item is being waived.", { reason: ["A reason is required to waive a checklist item."] });
  if (stage.status === "not_started") throw precondition(`Start “${stage.name}” before waiving its checklist items.`);
  if (item.status === "waived") throw precondition("This item is already waived.");
  await getDb().transaction(async (tx) => {
    await tx.update(ci).set({ status: "waived", waivedReason: text, statusChangedBy: ctx.userId, statusChangedAt: new Date(), completedAt: null, completedBy: null }).where(eq(ci.id, item.id));
    await record(ctx, tx, project, "checklist.waive", "checklist_item", item.id, `Waived ${item.isRequired ? "required" : "optional"} checklist item in “${stage.name}”: ${clip(item.title, 100)}`, stageMeta(stage, { itemId: item.id, from: item.status, to: "waived", required: item.isRequired, reason: clip(text) }));
  });
  return { id: item.id, status: "waived" };
}

/** Only optional items that were added to this project can be removed. Template items and required items are waived instead. */
export async function deleteChecklistItem(ctx: Ctx, projectId: string, stageId: string, itemId: string): Promise<void> {
  assertCanEdit(ctx);
  const { project, lifecycle, stage } = await requireStage(ctx, projectId, stageId);
  assertLifecycleActive(lifecycle);
  assertStageOpen(stage);
  const item = await requireItem(stage, itemId);
  if (item.isRequired || item.origin !== "custom") throw precondition("Required items and items from the template cannot be deleted. Waive the item with a reason instead.");
  const [linked] = await getDb().select({ id: ev.id }).from(ev).where(eq(ev.checklistItemId, item.id)).limit(1);
  if (linked) throw precondition("Evidence is attached to this item, so it cannot be deleted. Waive it instead.");
  await getDb().transaction(async (tx) => {
    await tx.delete(ci).where(eq(ci.id, item.id));
    await record(ctx, tx, project, "checklist.delete", "checklist_item", item.id, `Removed optional checklist item from “${stage.name}”: ${clip(item.title, 120)}`, stageMeta(stage, { itemId: item.id }));
  });
}

// ── Evidence ────────────────────────────────────────────────────────────────
export async function listStageEvidence(ctx: Ctx, projectId: string, stageId: string): Promise<EvidenceView[]> {
  await requireStage(ctx, projectId, stageId);
  const view = await getProjectLifecycle(ctx, projectId);
  return view.stages.find((s) => s.id === stageId)?.evidence ?? [];
}

/** Add a reference: a generated artifact of this project, a safe URL, or a note. Nothing is uploaded or copied. */
export async function addStageEvidence(ctx: Ctx, projectId: string, stageId: string, input: EvidenceCreateInput): Promise<{ id: string }> {
  assertCanEdit(ctx);
  const { project, lifecycle, stage } = await requireStage(ctx, projectId, stageId);
  assertLifecycleActive(lifecycle);
  assertStageOpen(stage);
  if (input.checklistItemId) await requireItem(stage, input.checklistItemId);
  if (input.evidenceType === "url") {
    // Checked again here so an unsafe scheme cannot be stored by a caller that skipped the request schema.
    const problem = evidenceUrlProblem(input.url ?? "");
    if (problem) throw new AppError("validation_error", problem, { url: [problem] });
  }
  const db = getDb();
  let artifactId: string | null = null;
  let artifactRevisionId: string | null = null;
  if (input.evidenceType === "artifact") {
    // The artifact must belong to this project, and the revision to that artifact.
    const a = schema.artifacts;
    const ar = schema.artifactRevisions;
    const [artifact] = await db.select({ id: a.id }).from(a).where(and(eq(a.id, input.artifactId!), eq(a.projectId, project.id))).limit(1);
    if (!artifact) throw notFound("Artifact");
    const [revision] = input.artifactRevisionId
      ? await db.select({ id: ar.id }).from(ar).where(and(eq(ar.id, input.artifactRevisionId), eq(ar.artifactId, artifact.id))).limit(1)
      : await db.select({ id: ar.id }).from(ar).where(eq(ar.artifactId, artifact.id)).orderBy(desc(ar.version)).limit(1);
    if (!revision) throw notFound("Artifact version");
    artifactId = artifact.id;
    artifactRevisionId = revision.id;
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(ev)
      .values({ workspaceId: ctx.workspaceId, stageInstanceId: stage.id, checklistItemId: input.checklistItemId ?? null, artifactId, artifactRevisionId, title: input.title, evidenceType: input.evidenceType, url: input.evidenceType === "url" ? input.url!.trim() : null, note: input.note?.trim() || null, createdBy: ctx.userId })
      .returning({ id: ev.id });
    await record(ctx, tx, project, "evidence.add", "stage_evidence", row!.id, `Added ${input.evidenceType} evidence to “${stage.name}”: ${clip(input.title, 120)}`, stageMeta(stage, { evidenceId: row!.id, evidenceType: input.evidenceType, checklistItemId: input.checklistItemId ?? null, artifactId, artifactRevisionId }));
    return row!;
  });
}

/** Evidence is never edited or deleted. A wrong reference is marked superseded, with who, when and why. */
export async function supersedeStageEvidence(ctx: Ctx, projectId: string, stageId: string, evidenceId: string, reason: string): Promise<{ id: string }> {
  assertCanEdit(ctx);
  const { project, lifecycle, stage } = await requireStage(ctx, projectId, stageId);
  assertLifecycleActive(lifecycle);
  assertStageOpen(stage);
  if (!UUID.test(evidenceId)) throw notFound("Evidence");
  const [row] = await getDb().select().from(ev).where(and(eq(ev.id, evidenceId), eq(ev.stageInstanceId, stage.id), eq(ev.workspaceId, ctx.workspaceId))).limit(1);
  if (!row) throw notFound("Evidence");
  if (row.supersededAt) throw precondition("This evidence is already marked superseded.");
  await getDb().transaction(async (tx) => {
    await tx.update(ev).set({ supersededAt: new Date(), supersededBy: ctx.userId, supersededReason: reason.trim() }).where(and(eq(ev.id, row.id), isNull(ev.supersededAt)));
    await record(ctx, tx, project, "evidence.supersede", "stage_evidence", row.id, `Marked evidence superseded in “${stage.name}”: ${clip(row.title, 120)}`, stageMeta(stage, { evidenceId: row.id, reason: clip(reason.trim()) }));
  });
  return { id: row.id };
}

// ── Approvals ───────────────────────────────────────────────────────────────
/** Ask the reviewer to approve the stage gate. Allowed only when every other gate condition already holds. */
export async function requestStageApproval(ctx: Ctx, projectId: string, stageId: string, input: { reviewerId?: string; note: string }): Promise<{ id: string }> {
  assertCanEdit(ctx);
  const { project, lifecycle, stage } = await requireStage(ctx, projectId, stageId);
  assertLifecycleActive(lifecycle);
  if (!stage.requiresApproval) throw precondition(`“${stage.name}” has no approval gate. Complete the stage directly.`);
  if (stage.status !== "in_progress") throw precondition(`“${stage.name}” is ${statusLabel(stage.status).toLowerCase()}; approval can be requested for a stage in progress.`);
  const reviewerId = input.reviewerId ?? stage.reviewerId;
  if (!reviewerId) throw new AppError("validation_error", "Assign a reviewer before requesting approval.", { reviewerId: ["Choose who reviews this stage gate."] });
  const reviewer = await requireMember(ctx, reviewerId, "reviewerId", { canDecide: true });
  const gate = await stageGate(project, stage, "request");
  if (!gate.ready) throw gateError(stage, "be sent for approval", gate.blockers);

  return getDb().transaction(async (tx) => {
    await moveStage(tx, stage, "pending_approval", { reviewerId: reviewer.id });
    const [approval] = await tx.insert(ap).values({ workspaceId: ctx.workspaceId, stageInstanceId: stage.id, status: "requested", requestedBy: ctx.userId, reviewerId: reviewer.id, requestNote: input.note }).returning({ id: ap.id });
    await record(ctx, tx, project, "approval.request", "stage_approval", approval!.id, `Requested approval of “${stage.name}” from ${reviewer.name}`, stageMeta(stage, { approvalId: approval!.id, reviewerId: reviewer.id, from: stage.status, to: "pending_approval" }));
    return approval!;
  });
}

/**
 * Approve, reject or withdraw an open request. Approving re-checks the gate against current records and, when it
 * holds, completes the stage. Rejecting or withdrawing returns the stage to in progress. A decided request is never
 * reopened or overwritten — a new request is a new row.
 */
export async function decideStageApproval(ctx: Ctx, projectId: string, stageId: string, approvalId: string, decision: "approve" | "reject" | "withdraw", note: string): Promise<{ id: string; status: ApprovalStatus; stageStatus: StageStatus }> {
  assertCanEdit(ctx);
  const { project, lifecycle, stage } = await requireStage(ctx, projectId, stageId);
  if (!UUID.test(approvalId)) throw notFound("Approval");
  const [approval] = await getDb().select().from(ap).where(and(eq(ap.id, approvalId), eq(ap.stageInstanceId, stage.id), eq(ap.workspaceId, ctx.workspaceId))).limit(1);
  if (!approval) throw notFound("Approval");
  assertLifecycleActive(lifecycle);
  if (approval.status !== "requested") throw precondition(`This request was already ${approval.status}. Request approval again to get a new decision.`);
  if (decision === "withdraw") {
    if (approval.requestedBy !== ctx.userId && ctx.role !== "owner") throw forbidden("Only the person who requested this approval, or a workspace owner, can withdraw it.");
  } else if (approval.reviewerId !== ctx.userId && ctx.role !== "owner") {
    throw forbidden("Only the assigned reviewer or a workspace owner can decide this approval.");
  }
  if (decision === "reject" && !note.trim()) throw new AppError("validation_error", "Tell the requester what has to change.", { note: ["A note is required to reject."] });
  if (decision === "approve") {
    const gate = await stageGate(project, stage, "request");
    if (!gate.ready) throw gateError(stage, "be approved", gate.blockers);
  }

  const status: ApprovalStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "withdrawn";
  const stageStatus: StageStatus = decision === "approve" ? "completed" : "in_progress";
  const now = new Date();
  await getDb().transaction(async (tx) => {
    const [decided] = await tx.update(ap).set({ status, decidedBy: ctx.userId, decidedAt: now, decisionNote: note.trim() || null }).where(and(eq(ap.id, approval.id), eq(ap.status, "requested"))).returning({ id: ap.id });
    if (!decided) throw conflict("This request was decided by someone else. Reload to see the result.");
    await moveStage(tx, stage, stageStatus, decision === "approve" ? { completedAt: now, completionNote: note.trim() || null, blockedReason: null } : {});
    const verb = decision === "approve" ? "Approved" : decision === "reject" ? "Rejected" : "Withdrew";
    await record(ctx, tx, project, `approval.${decision}`, "stage_approval", approval.id, `${verb} the approval request for “${stage.name}”${decision === "reject" ? `: ${clip(note.trim(), 160)}` : ""}`, stageMeta(stage, { approvalId: approval.id, from: "requested", to: status }));
    if (decision === "approve") await record(ctx, tx, project, "stage.complete", "lifecycle_stage", stage.id, `Completed stage “${stage.name}” on approval`, stageMeta(stage, { from: stage.status, to: "completed", approvalId: approval.id }));
  });
  return { id: approval.id, status, stageStatus };
}

// ── Milestones ──────────────────────────────────────────────────────────────
const milestoneView = (m: Milestone, user: (id: string | null) => UserRef | null, now: Date): MilestoneView => ({
  id: m.id,
  name: m.name,
  description: m.description,
  status: m.status,
  owner: user(m.ownerId),
  dueAt: iso(m.dueAt),
  overdue: isOverdue(m.dueAt, !isMilestoneOpen(m.status), now),
  completedAt: iso(m.completedAt),
  createdAt: m.createdAt.toISOString(),
  updatedAt: m.updatedAt.toISOString(),
});

/** Milestones by due date, undated ones last. */
export async function listMilestones(ctx: Ctx, projectId: string, now: Date = new Date()): Promise<MilestoneView[]> {
  const project = await getProject(ctx, projectId);
  const rows = await getDb().select().from(ms).where(and(eq(ms.projectId, project.id), eq(ms.workspaceId, ctx.workspaceId))).orderBy(sql`${ms.dueAt} asc nulls last`, asc(ms.createdAt));
  const user = await userNames(rows.map((r) => r.ownerId));
  return rows.map((r) => milestoneView(r, user, now));
}

async function requireMilestone(ctx: Ctx, project: Project, milestoneId: string): Promise<Milestone> {
  if (!UUID.test(milestoneId)) throw notFound("Milestone");
  const [row] = await getDb().select().from(ms).where(and(eq(ms.id, milestoneId), eq(ms.projectId, project.id), eq(ms.workspaceId, ctx.workspaceId))).limit(1);
  if (!row) throw notFound("Milestone");
  return row;
}

export async function createMilestone(ctx: Ctx, projectId: string, input: Omit<MilestoneCreateInput, "dueAt"> & { dueAt: Date | null }): Promise<{ id: string }> {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  if (input.ownerId) await requireMember(ctx, input.ownerId, "ownerId");
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(ms)
      .values({ workspaceId: ctx.workspaceId, projectId: project.id, name: input.name, description: input.description, status: input.status, ownerId: input.ownerId, dueAt: input.dueAt, completedAt: input.status === "completed" ? new Date() : null, createdBy: ctx.userId })
      .returning({ id: ms.id });
    await record(ctx, tx, project, "milestone.create", "project_milestone", row!.id, `Added milestone “${clip(input.name, 120)}”${input.dueAt ? `, due ${input.dueAt.toISOString().slice(0, 10)}` : ""}`, { milestoneId: row!.id, status: input.status });
    return row!;
  });
}

export async function updateMilestone(ctx: Ctx, projectId: string, milestoneId: string, input: Omit<MilestoneUpdateInput, "dueAt"> & { dueAt?: Date | null }): Promise<{ id: string; status: MilestoneStatus }> {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const row = await requireMilestone(ctx, project, milestoneId);
  if (input.ownerId) await requireMember(ctx, input.ownerId, "ownerId");
  const patch: Partial<Milestone> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
  if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
  const statusChanged = input.status !== undefined && input.status !== row.status;
  if (statusChanged) {
    patch.status = input.status;
    patch.completedAt = input.status === "completed" ? new Date() : null;
  }
  const action = statusChanged && input.status === "completed" ? "milestone.complete" : statusChanged && input.status === "cancelled" ? "milestone.cancel" : "milestone.update";
  const name = patch.name ?? row.name;
  const summary = statusChanged ? `Milestone “${clip(name, 120)}” set to ${statusLabel(input.status!).toLowerCase()}` : `Updated milestone “${clip(name, 120)}”`;
  await getDb().transaction(async (tx) => {
    await tx.update(ms).set(patch).where(eq(ms.id, row.id));
    await record(ctx, tx, project, action, "project_milestone", row.id, summary, { milestoneId: row.id, ...(statusChanged ? { from: row.status, to: input.status } : {}), ...(input.dueAt !== undefined ? { dueAt: { from: iso(row.dueAt), to: iso(input.dueAt) } } : {}) });
  });
  return { id: row.id, status: patch.status ?? row.status };
}

export async function deleteMilestone(ctx: Ctx, projectId: string, milestoneId: string): Promise<void> {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const row = await requireMilestone(ctx, project, milestoneId);
  await getDb().transaction(async (tx) => {
    await tx.delete(ms).where(eq(ms.id, row.id));
    await record(ctx, tx, project, "milestone.delete", "project_milestone", row.id, `Deleted milestone “${clip(row.name, 120)}”`, { milestoneId: row.id, status: row.status });
  });
}

// ── Risks ───────────────────────────────────────────────────────────────────
const riskView = (r: Risk, user: (id: string | null) => UserRef | null, now: Date): RiskView => {
  const score = riskScore(r.likelihood, r.impact);
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    likelihood: r.likelihood,
    impact: r.impact,
    score,
    level: riskLevel(score),
    status: r.status,
    owner: user(r.ownerId),
    mitigation: r.mitigation,
    dueAt: iso(r.dueAt),
    overdue: isOverdue(r.dueAt, !isRiskOpen(r.status), now),
    resolvedAt: iso(r.resolvedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
};

/** The register, highest score first. */
export async function listRisks(ctx: Ctx, projectId: string, now: Date = new Date()): Promise<RiskView[]> {
  const project = await getProject(ctx, projectId);
  const rows = await getDb().select().from(rk).where(and(eq(rk.projectId, project.id), eq(rk.workspaceId, ctx.workspaceId))).orderBy(sql`${rk.likelihood} * ${rk.impact} desc`, asc(rk.createdAt));
  const user = await userNames(rows.map((r) => r.ownerId));
  return rows.map((r) => riskView(r, user, now));
}

async function requireRisk(ctx: Ctx, project: Project, riskId: string): Promise<Risk> {
  if (!UUID.test(riskId)) throw notFound("Risk");
  const [row] = await getDb().select().from(rk).where(and(eq(rk.id, riskId), eq(rk.projectId, project.id), eq(rk.workspaceId, ctx.workspaceId))).limit(1);
  if (!row) throw notFound("Risk");
  return row;
}

const isClosedRisk = (status: RiskStatus) => status === "resolved" || status === "closed";

export async function createRisk(ctx: Ctx, projectId: string, input: Omit<RiskCreateInput, "dueAt"> & { dueAt: Date | null }): Promise<RiskView> {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const score = riskScore(input.likelihood, input.impact);
  if (input.ownerId) await requireMember(ctx, input.ownerId, "ownerId");
  const row = await getDb().transaction(async (tx) => {
    const [created] = await tx
      .insert(rk)
      .values({ workspaceId: ctx.workspaceId, projectId: project.id, title: input.title, description: input.description, category: input.category, likelihood: input.likelihood, impact: input.impact, status: input.status, ownerId: input.ownerId, mitigation: input.mitigation, dueAt: input.dueAt, resolvedAt: isClosedRisk(input.status) ? new Date() : null, createdBy: ctx.userId })
      .returning();
    await record(ctx, tx, project, "risk.create", "project_risk", created!.id, `Recorded ${riskLevel(score)} risk “${clip(input.title, 120)}” (score ${score})`, { riskId: created!.id, likelihood: input.likelihood, impact: input.impact, score, status: input.status });
    return created!;
  });
  return riskView(row, await userNames([row.ownerId]), new Date());
}

export async function updateRisk(ctx: Ctx, projectId: string, riskId: string, input: Omit<RiskUpdateInput, "dueAt"> & { dueAt?: Date | null }): Promise<RiskView> {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const row = await requireRisk(ctx, project, riskId);
  if (input.ownerId) await requireMember(ctx, input.ownerId, "ownerId");
  const likelihood = input.likelihood ?? row.likelihood;
  const impact = input.impact ?? row.impact;
  const score = riskScore(likelihood, impact);
  const patch: Partial<Risk> = {};
  for (const key of ["title", "description", "category", "likelihood", "impact", "ownerId", "mitigation", "dueAt"] as const) {
    if (input[key] !== undefined) Object.assign(patch, { [key]: input[key] });
  }
  const statusChanged = input.status !== undefined && input.status !== row.status;
  const mitigationChanged = input.mitigation !== undefined && input.mitigation !== row.mitigation;
  if (statusChanged) {
    patch.status = input.status;
    patch.resolvedAt = isClosedRisk(input.status!) ? new Date() : null;
  }
  const verbs: Partial<Record<RiskStatus, string>> = { accepted: "accept", resolved: "resolve", closed: "close" };
  const title = patch.title ?? row.title;
  const meta = { riskId: row.id, score, ...(row.likelihood !== likelihood || row.impact !== impact ? { scoreFrom: row.likelihood * row.impact } : {}) };
  // One event per kind of change, so a status decision and a mitigation edit are each visible in the trail.
  const events: { action: string; summary: string; metadata: Record<string, unknown> }[] = [];
  if (statusChanged) events.push({ action: `risk.${verbs[input.status!] ?? "update"}`, summary: `Risk “${clip(title, 120)}” set to ${statusLabel(input.status!).toLowerCase()}`, metadata: { ...meta, from: row.status, to: input.status } });
  if (mitigationChanged) events.push({ action: "risk.mitigation", summary: `Updated the mitigation of risk “${clip(title, 120)}”`, metadata: meta });
  if (!events.length) events.push({ action: "risk.update", summary: `Updated risk “${clip(title, 120)}” (score ${score})`, metadata: meta });
  const [updated] = await getDb().transaction(async (tx) => {
    const rows = await tx.update(rk).set(patch).where(eq(rk.id, row.id)).returning();
    for (const event of events) await record(ctx, tx, project, event.action, "project_risk", row.id, event.summary, event.metadata);
    return rows;
  });
  return riskView(updated!, await userNames([updated!.ownerId]), new Date());
}

export const resolveRisk = (ctx: Ctx, projectId: string, riskId: string) => updateRisk(ctx, projectId, riskId, { status: "resolved" });

// ── Portfolio ───────────────────────────────────────────────────────────────
export interface PortfolioRow {
  project: { id: string; name: string; description: string; status: "active" | "archived"; isDemo: boolean; owner: string | null };
  lifecycle: null | {
    id: string;
    status: LifecycleStatus;
    /** Required stages completed or skipped ÷ required stages. */
    percent: number;
    requiredStages: number;
    requiredStagesDone: number;
    currentStage: { id: string; stageKey: string; name: string; status: StageStatus; dueAt: string | null; overdue: boolean; sortOrder: number } | null;
    blockedStages: number;
    overdueStages: number;
    pendingApprovals: number;
  };
  nextMilestone: { id: string; name: string; dueAt: string | null; overdue: boolean } | null;
  overdueMilestones: number;
  openRisks: number;
  highRisks: number;
  /** Earliest open due date across the current stage and milestones, for sorting. */
  nextDueAt: string | null;
  overdue: boolean;
  updatedAt: string;
}

export interface PortfolioMilestone {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  status: MilestoneStatus;
  dueAt: string;
  overdue: boolean;
}

/** Every project of the workspace with its derived lifecycle position. Six queries regardless of the number of projects. */
export async function getPortfolio(ctx: Ctx, options: { includeArchived?: boolean; now?: Date } = {}): Promise<{ rows: PortfolioRow[]; milestones: PortfolioMilestone[] }> {
  const now = options.now ?? new Date();
  const db = getDb();
  const p = schema.projects;
  const projects = await db
    .select({ project: p, owner: schema.users.name })
    .from(p)
    .leftJoin(schema.users, eq(schema.users.id, p.ownerId))
    .where(and(eq(p.workspaceId, ctx.workspaceId), options.includeArchived ? undefined : eq(p.status, "active")))
    .orderBy(desc(p.updatedAt));
  if (!projects.length) return { rows: [], milestones: [] };
  const projectIds = projects.map((r) => r.project.id);
  const [lifecycles, stages, milestones, risks, pending] = await Promise.all([
    db.select().from(lc).where(and(eq(lc.workspaceId, ctx.workspaceId), inArray(lc.projectId, projectIds))),
    db
      .select({ id: st.id, lifecycleId: st.projectLifecycleId, stageKey: st.stageKey, name: st.name, sortOrder: st.sortOrder, isRequired: st.isRequired, status: st.status, dueAt: st.dueAt, updatedAt: st.updatedAt })
      .from(st)
      .innerJoin(lc, eq(lc.id, st.projectLifecycleId))
      .where(and(eq(st.workspaceId, ctx.workspaceId), inArray(lc.projectId, projectIds))),
    db.select({ id: ms.id, projectId: ms.projectId, name: ms.name, status: ms.status, dueAt: ms.dueAt }).from(ms).where(and(eq(ms.workspaceId, ctx.workspaceId), inArray(ms.projectId, projectIds), inArray(ms.status, ["planned", "in_progress", "at_risk"]))).orderBy(sql`${ms.dueAt} asc nulls last`),
    db.select({ projectId: rk.projectId, likelihood: rk.likelihood, impact: rk.impact }).from(rk).where(and(eq(rk.workspaceId, ctx.workspaceId), inArray(rk.projectId, projectIds), inArray(rk.status, ["open", "mitigating"]))),
    db.select({ stageId: ap.stageInstanceId }).from(ap).where(and(eq(ap.workspaceId, ctx.workspaceId), eq(ap.status, "requested"))),
  ]);
  const pendingStages = new Set(pending.map((x) => x.stageId));

  const rows = projects.map(({ project, owner }): PortfolioRow => {
    const lifecycle = lifecycles.find((l) => l.projectId === project.id) ?? null;
    const own = lifecycle ? stages.filter((s) => s.lifecycleId === lifecycle.id) : [];
    const progress = lifecycle ? computeProgress(own, [], now) : null;
    const current = progress ? (own.find((s) => s.id === progress.currentStageId) ?? null) : null;
    const open = milestones.filter((m) => m.projectId === project.id);
    const next = open[0] ?? null;
    const projectRisks = risks.filter((r) => r.projectId === project.id);
    const overdueMilestones = open.filter((m) => isOverdue(m.dueAt, false, now)).length;
    const dueDates = [current?.dueAt ?? null, ...open.map((m) => m.dueAt)].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
    const updated = [project.updatedAt, lifecycle?.updatedAt, ...own.map((s) => s.updatedAt)].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0]!;
    return {
      project: { id: project.id, name: project.name, description: project.description, status: project.status, isDemo: project.isDemo, owner },
      lifecycle:
        lifecycle && progress
          ? {
              id: lifecycle.id,
              status: lifecycle.status,
              percent: progress.percent,
              requiredStages: progress.requiredStages,
              requiredStagesDone: progress.requiredStagesDone,
              currentStage: current ? { id: current.id, stageKey: current.stageKey, name: current.name, status: current.status, dueAt: iso(current.dueAt), overdue: progress.overdueStageIds.includes(current.id), sortOrder: current.sortOrder } : null,
              blockedStages: progress.blockedStageIds.length,
              overdueStages: progress.overdueStageIds.length,
              pendingApprovals: own.filter((s) => pendingStages.has(s.id)).length,
            }
          : null,
      nextMilestone: next ? { id: next.id, name: next.name, dueAt: iso(next.dueAt), overdue: isOverdue(next.dueAt, false, now) } : null,
      overdueMilestones,
      openRisks: projectRisks.length,
      highRisks: projectRisks.filter((r) => r.likelihood * r.impact >= 10).length,
      nextDueAt: iso(dueDates[0] ?? null),
      overdue: overdueMilestones > 0 || (progress?.overdueStageIds.length ?? 0) > 0,
      updatedAt: updated.toISOString(),
    };
  });

  const names = new Map(projects.map((r) => [r.project.id, r.project.name]));
  return {
    rows,
    milestones: milestones.filter((m) => m.dueAt).map((m) => ({ id: m.id, projectId: m.projectId, projectName: names.get(m.projectId) ?? "", name: m.name, status: m.status, dueAt: m.dueAt!.toISOString(), overdue: isOverdue(m.dueAt, false, now) })),
  };
}

export interface PortfolioStats {
  /** Active projects whose lifecycle is active. */
  activeLifecycles: number;
  /** Active projects that have no lifecycle yet. */
  notStarted: number;
  byStage: { stageKey: string; name: string; count: number }[];
  blockedProjects: number;
  overdueMilestones: number;
  highRisks: number;
  pendingApprovals: number;
  attention: { projectId: string; projectName: string; reasons: { kind: "blocked" | "overdue" | "approval"; text: string }[] }[];
  upcomingMilestones: PortfolioMilestone[];
}

/** Mission Control figures for active projects. Every number is counted from persisted rows on each request. */
export async function getLifecyclePortfolioStats(ctx: Ctx, now: Date = new Date()): Promise<PortfolioStats> {
  const { rows, milestones } = await getPortfolio(ctx, { now });
  const live = rows.filter((r) => r.lifecycle?.status === "active");
  const byStage = new Map<string, { stageKey: string; name: string; count: number; order: number }>();
  for (const row of live) {
    const stage = row.lifecycle!.currentStage;
    if (!stage) continue;
    const entry = byStage.get(stage.name) ?? { stageKey: stage.stageKey, name: stage.name, count: 0, order: stage.sortOrder };
    entry.count += 1;
    byStage.set(stage.name, entry);
  }
  const attention = live
    .map((row) => {
      const l = row.lifecycle!;
      const reasons: PortfolioStats["attention"][number]["reasons"] = [];
      if (l.blockedStages) reasons.push({ kind: "blocked", text: `${l.blockedStages} blocked stage${l.blockedStages === 1 ? "" : "s"}` });
      if (l.overdueStages) reasons.push({ kind: "overdue", text: `${l.overdueStages} overdue stage${l.overdueStages === 1 ? "" : "s"}` });
      if (row.overdueMilestones) reasons.push({ kind: "overdue", text: `${row.overdueMilestones} overdue milestone${row.overdueMilestones === 1 ? "" : "s"}` });
      if (l.pendingApprovals) reasons.push({ kind: "approval", text: `${l.pendingApprovals} approval${l.pendingApprovals === 1 ? "" : "s"} pending` });
      return { projectId: row.project.id, projectName: row.project.name, reasons };
    })
    .filter((x) => x.reasons.length > 0);
  return {
    activeLifecycles: live.length,
    notStarted: rows.filter((r) => !r.lifecycle).length,
    byStage: [...byStage.values()].sort((a, b) => a.order - b.order).map(({ stageKey, name, count }) => ({ stageKey, name, count })),
    blockedProjects: live.filter((r) => r.lifecycle!.blockedStages > 0).length,
    overdueMilestones: rows.reduce((n, r) => n + r.overdueMilestones, 0),
    highRisks: rows.reduce((n, r) => n + r.highRisks, 0),
    pendingApprovals: live.reduce((n, r) => n + r.lifecycle!.pendingApprovals, 0),
    attention,
    upcomingMilestones: milestones.slice(0, 8),
  };
}

/** Compact result of a stage change, for API responses: the stage's new status and the lifecycle position it produces. */
export function stageResult(view: LifecycleView, stageId: string) {
  const stage = view.stages.find((s) => s.id === stageId);
  return {
    stage: stage ? { id: stage.id, stageKey: stage.stageKey, status: stage.status, blockers: stage.readiness.blockers } : null,
    lifecycle: { status: view.lifecycle?.status ?? null, percent: view.progress?.percent ?? 0, currentStageId: view.progress?.currentStageId ?? null },
  };
}
