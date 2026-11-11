import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { CANDIDATE_LABELS, NODE_KINDS } from "@/lib/catalog";
import { validateDiagram, type DiagramIssue } from "@/lib/diagram";
import { INTAKE_FIELDS, intakeField } from "@/lib/intake";
import type { BlueprintSection, DiagramModel, TrustOrigin } from "@/lib/types";
import { pct } from "@/lib/utils";
import { audit } from "../audit";
import { assertCanEdit, type Ctx } from "../ctx";
import { hashJson } from "../crypto";
import { getDb, schema } from "../db";
import { AppError, conflict, notFound, precondition } from "../errors";
import { getCandidate, type Candidate } from "./finder";
import { getItemsByIds, getItemSources, type KnowledgeItem } from "./knowledge";
import { getProject, getRequirements, type Project, type Requirement } from "./projects";

const rev = schema.architectureRevisions;
const adr = schema.decisionRecords;
export type Revision = typeof rev.$inferSelect;
export type Decision = typeof adr.$inferSelect;

const TODO = "TODO";
const bullet = (lines: string[], empty: string) => (lines.length ? lines.map((l) => `- ${l}`).join("\n") : empty);

function requirementLine(requirements: Requirement[], field: string): string {
  const r = requirements.find((x) => x.field === field);
  const label = intakeField(field)?.label ?? field;
  if (!r || r.state === "unknown") return `- **${label}:** ${TODO} — unknown. ${intakeField(field)?.question ?? ""}`;
  if (r.state === "not-applicable") return `- **${label}:** not applicable`;
  return `- **${label}:** ${r.value}${r.kind === "assumption" ? " _(assumption — confirm)_" : ""}`;
}

/** Compose the blueprint sections from approved requirements, the chosen candidate and its reference scenario. */
export function buildSections(input: {
  project: Project;
  requirements: Requirement[];
  candidate: Candidate;
  alternatives: Candidate[];
  scenario: KnowledgeItem | null;
  related: { title: string; type: string; status: string }[];
  sources: { title: string; url: string | null; sourceType: string }[];
}): BlueprintSection[] {
  const { project, requirements, candidate, alternatives, scenario, related, sources } = input;
  const diagram = candidate.diagram;
  const fromScenario = (key: string) => scenario?.sections.find((s) => s.key === key)?.body ?? "";
  const refOrigin: TrustOrigin = scenario ? (candidate.label === "exact-reference" ? "reference" : "adapted") : "generated";
  const req = (fields: string[]) => fields.map((f) => requirementLine(requirements, f)).join("\n");
  const nodesOf = (kinds: string[]) => diagram.nodes.filter((n) => kinds.includes(n.kind));
  const names = (kinds: string[]) => nodesOf(kinds).map((n) => `${n.label}${n.technology ? ` (${n.technology})` : ""}`);
  const label = CANDIDATE_LABELS[candidate.label].label;
  const section = (key: string, title: string, origin: TrustOrigin, body: string): BlueprintSection => ({ key, title, origin, body: body.trim(), edited: false });
  const withReference = (text: string, fallback: string) => (text ? text : `${TODO}: ${fallback}`);

  return [
    section(
      "executive-summary",
      "Executive summary",
      "generated",
      `**Project:** ${project.name}\n\n${project.description || `${TODO}: add a one-paragraph project description.`}\n\n**Recommended option:** ${candidate.title} — _${label}_.\n\n${candidate.summary}\n\nFit score ${pct(candidate.score)} at ${pct(candidate.confidence)} confidence. The score is a decision aid produced by ${candidate.generator}; it is not a measurement, and it does not replace review of the gaps and assumptions listed in this blueprint.`,
    ),
    section("context-requirements", "Context and requirements", "user", `Approved requirements for this revision:\n\n${INTAKE_FIELDS.map((f) => requirementLine(requirements, f.key)).join("\n")}`),
    section(
      "selected-option",
      "Selected option and alternatives",
      refOrigin,
      `**Selected:** ${candidate.title} (${label}).\n\n**Why it ranked:**\n${bullet(candidate.matchReasons, "- No match evidence recorded.")}\n\n**Factor breakdown:**\n${bullet(candidate.factors.map((f) => `${f.label}: ${pct(f.score)} × weight ${pct(f.weight)}${f.known ? "" : " (inputs unknown — neutral score)"}`), "- Not scored.")}\n\n**Gaps to close:**\n${bullet(candidate.gaps, "- None identified.")}\n\n**Alternatives considered:**\n${bullet(alternatives.map((a) => `${a.title} — ${CANDIDATE_LABELS[a.label].label}, fit ${pct(a.score)}`), "- No other candidate passed the filters.")}`,
    ),
    section("l0-context", "L0 — System context", refOrigin, `**Source systems:**\n${bullet(names(["source"]), `- ${TODO}: list source systems.`)}\n\n**Consumers:**\n${bullet(names(["consumer"]), `- ${TODO}: list consuming users and applications.`)}\n\n${req(["source_systems", "users"])}`),
    section(
      "l1-logical",
      "L1 — Logical architecture",
      refOrigin,
      NODE_KINDS.filter((kind) => nodesOf([kind.key]).length > 0)
        .map((kind) => `**${kind.label}:** ${names([kind.key]).join("; ")}`)
        .join("\n\n") || `${TODO}: describe the logical layers.`,
    ),
    section(
      "l2-components",
      "L2 — Component architecture",
      refOrigin,
      `| ID | Component | Type | Technology | Purpose |\n|---|---|---|---|---|\n${diagram.nodes.map((n) => `| ${n.id} | ${n.label} | ${n.kind} | ${n.technology ?? TODO} | ${n.description.replace(/\|/g, "/").replace(/\n/g, " ") || TODO} |`).join("\n")}`,
    ),
    section("l3-deployment", "L3 — Deployment details", "assumption", `${TODO}: environment-specific deployment details are not known to DataBrain and must be supplied.\n\n- Subscription / account / project IDs: PLACEHOLDER\n- Regions: PLACEHOLDER\n- Resource naming convention: PLACEHOLDER\n- Capacity / SKU selection: PLACEHOLDER — size from measured workload, not from this document.\n\n${req(["data_volume", "availability"])}`),
    section("data-flows", "Data flows", refOrigin, bullet(diagram.edges.map((e) => `${diagram.nodes.find((n) => n.id === e.source)?.label ?? e.source} → ${diagram.nodes.find((n) => n.id === e.target)?.label ?? e.target}${e.label ? `: ${e.label}` : ""}`), `${TODO}: describe data flows.`) + `\n\n${req(["latency"])}`),
    section("network-dns", "Network and DNS", scenario ? "adapted" : "assumption", `${req(["network"])}\n\n**Network components:**\n${bullet(names(["network"]), `- ${TODO}: no network components are modelled yet.`)}\n\n- Address ranges, DNS zones and firewall rules: PLACEHOLDER — never invented by DataBrain.`),
    section("identity-security", "Identity and security", scenario ? "adapted" : "assumption", `${req(["identity", "compliance"])}\n\n**Security components:**\n${bullet(names(["security"]), `- ${TODO}: no security components are modelled yet.`)}\n\n**From the reference scenario:**\n${withReference(fromScenario("security"), "the reference scenario has no security guidance.")}`),
    section("governance", "Governance", scenario ? "adapted" : "assumption", `**Governance components:**\n${bullet(names(["governance"]), `- ${TODO}: no governance components are modelled yet.`)}\n\n- Data ownership, classification and retention policy: ${TODO}.`),
    section("devops-iac", "DevOps and infrastructure as code", "generated", `${req(["cicd"])}\n\nStarter IaC and pipeline templates are produced by the Artifact Factory from this revision. They contain placeholders and must be reviewed before use.`),
    section("monitoring-dr", "Monitoring and disaster recovery", scenario ? "adapted" : "assumption", `${req(["availability"])}\n\n**Operations components:**\n${bullet(names(["operations"]), `- ${TODO}: no monitoring components are modelled yet.`)}\n\n- Backup schedule, RPO/RTO test evidence and alert routing: ${TODO}.`),
    section("sizing-cost", "Sizing and cost drivers", scenario ? "reference" : "assumption", `${req(["data_volume", "users", "budget"])}\n\n**Cost drivers (qualitative — DataBrain does not estimate prices):**\n${bullet(candidate.costDrivers, `- ${TODO}: identify cost drivers.`)}`),
    section("migration-phases", "Migration and deployment phases", scenario ? "adapted" : "generated", `${req(["timeline"])}\n\n${scenario?.attributes.steps?.length ? scenario.attributes.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") : withReference(fromScenario("implementation"), "define the delivery phases.")}`),
    section("risks", "Risks and mitigations", refOrigin, `**Trade-offs and limitations of the chosen option:**\n${bullet(candidate.tradeoffs, "- None recorded.")}\n\n**Open gaps:**\n${bullet(candidate.gaps, "- None identified.")}\n\n**Assumptions requiring validation:**\n${bullet(candidate.assumptions, "- None recorded.")}\n\nMitigation owner and due date for each item: ${TODO}.`),
    section("validation", "Validation and acceptance", scenario ? "adapted" : "generated", withReference(fromScenario("validation"), "define acceptance tests for each requirement.")),
    section("rollback", "Rollback", "generated", `${TODO}: define the rollback approach for each deployment phase. As a minimum, record the last known-good state, the trigger for rollback, and who decides.`),
    section("adrs", "Architecture decision records", "user", "Decision records for this project are kept alongside the blueprint and exported by the Artifact Factory."),
    section(
      "sources",
      "Sources",
      "reference",
      `**Reference knowledge:**\n${bullet([...(scenario ? [`${scenario.title} — scenario, status: ${scenario.status}`] : []), ...related.map((r) => `${r.title} — ${r.type}, status: ${r.status}`)], "- None: this blueprint is not based on stored knowledge.")}\n\n**Cited sources:**\n${bullet(sources.map((s) => `${s.title}${s.url ? ` — ${s.url}` : ""} (${s.sourceType})`), "- No sources are cited by the reference knowledge.")}`,
    ),
  ];
}

// ── Revisions ───────────────────────────────────────────────────────────────
export async function listRevisions(ctx: Ctx, projectId: string) {
  const project = await getProject(ctx, projectId);
  return getDb().select().from(rev).where(eq(rev.projectId, project.id)).orderBy(desc(rev.version));
}

export async function getRevision(ctx: Ctx, projectId: string, revisionId: string): Promise<Revision> {
  const project = await getProject(ctx, projectId);
  const [revision] = await getDb().select().from(rev).where(and(eq(rev.id, revisionId), eq(rev.projectId, project.id))).limit(1);
  if (!revision) throw notFound("Architecture revision");
  return revision;
}

export async function getApprovedRevision(ctx: Ctx, projectId: string): Promise<Revision | null> {
  const project = await getProject(ctx, projectId);
  const [revision] = await getDb().select().from(rev).where(and(eq(rev.projectId, project.id), eq(rev.status, "approved"))).orderBy(desc(rev.version)).limit(1);
  return revision ?? null;
}

async function nextVersion(projectId: string): Promise<number> {
  const [row] = await getDb().select({ v: sql<number>`coalesce(max(${rev.version}), 0)::int` }).from(rev).where(eq(rev.projectId, projectId));
  return (row?.v ?? 0) + 1;
}

export async function createRevisionFromCandidate(ctx: Ctx, projectId: string, candidateId: string) {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const candidate = await getCandidate(ctx, projectId, candidateId);
  const db = getDb();
  const [requirements, runCandidates] = await Promise.all([
    getRequirements(ctx, projectId),
    db.select().from(schema.architectureCandidates).where(and(eq(schema.architectureCandidates.projectId, project.id), eq(schema.architectureCandidates.run, candidate.run))).orderBy(schema.architectureCandidates.rank),
  ]);
  const k = schema.knowledgeItems;
  const [scenario] = candidate.scenarioId ? await db.select().from(k).where(and(eq(k.id, candidate.scenarioId), eq(k.workspaceId, ctx.workspaceId))).limit(1) : [];
  const related = await getItemsByIds(ctx, candidate.relatedItemIds);
  const sourceItemIds = [...(scenario ? [scenario.id] : []), ...related.map((r) => r.id)];
  const sources = (await getItemSources(ctx, sourceItemIds)).map((s) => s.source);
  const uniqueSources = [...new Map(sources.map((s) => [s.id, s])).values()];
  const alternatives = runCandidates.filter((x) => x.id !== candidate.id);

  const sections = buildSections({ project, requirements, candidate, alternatives, scenario: scenario ?? null, related, sources: uniqueSources });
  const version = await nextVersion(project.id);

  return db.transaction(async (tx) => {
    const [revision] = await tx
      .insert(rev)
      .values({ projectId: project.id, version, title: candidate.title, candidateId: candidate.id, scenarioId: candidate.scenarioId, label: candidate.label, sections, diagram: candidate.diagram, sourceItemIds, createdBy: ctx.userId })
      .returning();
    const [n] = await tx.select({ n: sql<number>`coalesce(max(${adr.number}), 0)::int` }).from(adr).where(eq(adr.projectId, project.id));
    await tx.insert(adr).values({
      projectId: project.id,
      revisionId: revision!.id,
      number: (n?.n ?? 0) + 1,
      title: `Adopt “${candidate.title}” as the target architecture`,
      status: "proposed",
      context: `Architecture Finder run ${candidate.run} ranked ${runCandidates.length} candidate(s) against the approved requirements.`,
      decision: `Proceed with “${candidate.title}” (${CANDIDATE_LABELS[candidate.label].label}, fit ${pct(candidate.score)}, confidence ${pct(candidate.confidence)}). TODO: record the human rationale for this choice.`,
      alternatives: alternatives.map((a) => `- ${a.title} — fit ${pct(a.score)}`).join("\n"),
      consequences: [...candidate.gaps.map((g) => `- Gap to close: ${g}`), ...candidate.tradeoffs.map((t) => `- Trade-off accepted: ${t}`)].join("\n"),
      candidateId: candidate.id,
      createdBy: ctx.userId,
    });
    await audit(ctx, { action: "revision.create", entityType: "architecture_revision", entityId: revision!.id, projectId: project.id, summary: `Created blueprint v${version} from “${candidate.title}”` }, tx);
    return revision!;
  });
}

export async function cloneRevision(ctx: Ctx, projectId: string, fromRevisionId: string) {
  assertCanEdit(ctx);
  const source = await getRevision(ctx, projectId, fromRevisionId);
  const version = await nextVersion(source.projectId);
  const [revision] = await getDb()
    .insert(rev)
    .values({ projectId: source.projectId, version, title: source.title, candidateId: source.candidateId, scenarioId: source.scenarioId, label: source.label, sections: source.sections, diagram: source.diagram, sourceItemIds: source.sourceItemIds, createdBy: ctx.userId })
    .returning();
  await audit(ctx, { action: "revision.clone", entityType: "architecture_revision", entityId: revision!.id, projectId: source.projectId, summary: `Created blueprint v${version} from v${source.version}` });
  return revision!;
}

export async function updateRevision(ctx: Ctx, projectId: string, revisionId: string, input: { lockVersion: number; title?: string; sections?: BlueprintSection[]; diagram?: DiagramModel }) {
  assertCanEdit(ctx);
  const revision = await getRevision(ctx, projectId, revisionId);
  if (revision.status !== "draft") throw precondition(`Revision v${revision.version} is ${revision.status} and can no longer be edited. Create a new revision to make changes.`);
  const [updated] = await getDb()
    .update(rev)
    .set({ title: input.title ?? revision.title, sections: input.sections ?? revision.sections, diagram: input.diagram ?? revision.diagram, lockVersion: revision.lockVersion + 1 })
    .where(and(eq(rev.id, revision.id), eq(rev.lockVersion, input.lockVersion), eq(rev.status, "draft")))
    .returning();
  if (!updated) throw conflict("This blueprint was saved elsewhere since you opened it. Reload to see the latest version before saving again.", { currentLockVersion: revision.lockVersion });
  await audit(ctx, { action: "revision.update", entityType: "architecture_revision", entityId: revision.id, projectId: revision.projectId, summary: `Edited blueprint v${revision.version}` });
  return updated;
}

export function revisionIssues(revision: Pick<Revision, "diagram" | "sections">): DiagramIssue[] {
  const issues = validateDiagram(revision.diagram);
  const empty = revision.sections.filter((s) => !s.body.trim());
  for (const s of empty) issues.push({ severity: "warning", message: `Section “${s.title}” is empty.` });
  const todos = revision.sections.filter((s) => /\bTODO\b|PLACEHOLDER/.test(s.body)).length;
  if (todos) issues.push({ severity: "warning", message: `${todos} section(s) still contain TODO or PLACEHOLDER markers.` });
  return issues;
}

export async function approveRevision(ctx: Ctx, projectId: string, revisionId: string, input: { lockVersion: number; note: string }) {
  assertCanEdit(ctx);
  if (ctx.role !== "owner") throw new AppError("forbidden", "Only a workspace owner can approve an architecture revision.");
  const project = await getProject(ctx, projectId);
  const revision = await getRevision(ctx, projectId, revisionId);
  if (revision.status !== "draft") throw precondition(`Revision v${revision.version} is already ${revision.status}.`);
  if (project.requirementsStatus !== "approved") throw precondition("Requirements changed after this blueprint was drafted. Approve the requirements again before approving the architecture.");
  const errors = revisionIssues(revision).filter((i) => i.severity === "error");
  if (errors.length) throw new AppError("precondition_failed", "The diagram has errors that must be fixed before approval.", { diagram: errors.map((e) => e.message) });

  const contentHash = hashJson({ title: revision.title, sections: revision.sections, diagram: revision.diagram });
  return getDb().transaction(async (tx) => {
    const [approved] = await tx
      .update(rev)
      .set({ status: "approved", approvedAt: new Date(), approvedBy: ctx.userId, approvalNote: input.note, contentHash, lockVersion: revision.lockVersion + 1 })
      .where(and(eq(rev.id, revision.id), eq(rev.lockVersion, input.lockVersion), eq(rev.status, "draft")))
      .returning();
    if (!approved) throw conflict("This blueprint changed since you opened it. Reload and review it again before approving.");
    await tx.update(rev).set({ status: "superseded" }).where(and(eq(rev.projectId, project.id), eq(rev.status, "approved"), sql`${rev.id} <> ${revision.id}`));
    await audit(ctx, { action: "revision.approve", entityType: "architecture_revision", entityId: revision.id, projectId: project.id, summary: `Approved blueprint v${revision.version}`, metadata: { contentHash, note: input.note } }, tx);
    return approved;
  });
}

// ── Decision records ────────────────────────────────────────────────────────
export async function listDecisions(ctx: Ctx, projectId: string) {
  const project = await getProject(ctx, projectId);
  return getDb().select().from(adr).where(eq(adr.projectId, project.id)).orderBy(adr.number);
}

type DecisionInput = { title: string; status: Decision["status"]; context: string; decision: string; alternatives: string; consequences: string; candidateId?: string | null; revisionId?: string | null };

export async function createDecision(ctx: Ctx, projectId: string, input: DecisionInput) {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  if (input.revisionId) await getRevision(ctx, projectId, input.revisionId);
  if (input.candidateId) await getCandidate(ctx, projectId, input.candidateId);
  const db = getDb();
  const [n] = await db.select({ n: sql<number>`coalesce(max(${adr.number}), 0)::int` }).from(adr).where(eq(adr.projectId, project.id));
  const [decision] = await db.insert(adr).values({ ...input, projectId: project.id, number: (n?.n ?? 0) + 1, createdBy: ctx.userId }).returning();
  await audit(ctx, { action: "decision.create", entityType: "decision_record", entityId: decision!.id, projectId: project.id, summary: `Recorded ADR-${decision!.number}: ${input.title}` });
  return decision!;
}

export async function updateDecision(ctx: Ctx, projectId: string, decisionId: string, input: DecisionInput) {
  assertCanEdit(ctx);
  const project = await getProject(ctx, projectId);
  const db = getDb();
  const [current] = await db.select().from(adr).where(and(eq(adr.id, decisionId), eq(adr.projectId, project.id))).limit(1);
  if (!current) throw notFound("Decision record");
  if (current.status === "accepted" && current.revisionId) {
    const [linked] = await db.select({ status: rev.status }).from(rev).where(inArray(rev.id, [current.revisionId])).limit(1);
    if (linked && linked.status !== "draft") throw precondition("This decision is accepted and part of an approved revision. Record a new decision that supersedes it instead of editing it.");
  }
  const [updated] = await db.update(adr).set({ title: input.title, status: input.status, context: input.context, decision: input.decision, alternatives: input.alternatives, consequences: input.consequences }).where(eq(adr.id, current.id)).returning();
  await audit(ctx, { action: "decision.update", entityType: "decision_record", entityId: current.id, projectId: project.id, summary: `Updated ADR-${current.number} (${input.status})` });
  return updated!;
}
