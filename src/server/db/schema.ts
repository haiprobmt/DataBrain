import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ApprovalScope,
  ArtifactValidation,
  BlueprintSection,
  CandidateFactor,
  DeploymentPlanBody,
  DiagramModel,
  FinderWeights,
  GenerationManifestBody,
  IntakeField,
  KnowledgeAttributes,
  KnowledgeSection,
  RunLogEntry,
  SkillCompatibility,
  SkillFile,
  SkillValidation,
} from "@/lib/types";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ── Identity ────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
  settings: jsonb("settings").$type<{ freshnessPolicyDays?: number; defaultWeights?: FinderWeights }>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "editor" | "viewer">().notNull().default("owner"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workspaceId] })],
);

// ── Knowledge ───────────────────────────────────────────────────────────────
export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    sections: jsonb("sections").$type<KnowledgeSection[]>().notNull().default([]),
    attributes: jsonb("attributes").$type<KnowledgeAttributes>().notNull().default({}),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").$type<"draft" | "reviewed" | "verified" | "archived">().notNull().default("draft"),
    origin: text("origin").$type<"human" | "imported" | "generated" | "demo-seed" | "ai-researched">().notNull().default("human"),
    sourceType: text("source_type").$type<"vendor-official" | "standards-framework" | "community" | "internal-experience" | "unspecified">().notNull().default("unspecified"),
    confidence: real("confidence"),
    version: integer("version").notNull().default(1),
    authorId: uuid("author_id").references(() => users.id),
    reviewerId: uuid("reviewer_id").references(() => users.id),
    reviewedAt: ts("reviewed_at"),
    lastVerifiedAt: ts("last_verified_at"),
    isDemo: boolean("is_demo").notNull().default(false),
    searchText: text("search_text").notNull().default(""),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title,'')), 'A') || setweight(to_tsvector('english', coalesce(summary,'')), 'B') || setweight(to_tsvector('english', coalesce(search_text,'')), 'C')`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("knowledge_items_ws_slug").on(t.workspaceId, t.slug),
    index("knowledge_items_search").using("gin", t.search),
    index("knowledge_items_type").on(t.workspaceId, t.type),
  ],
);

/** Immutable history of a knowledge item: a row is written before every update. */
export const knowledgeItemVersions = pgTable(
  "knowledge_item_versions",
  {
    id: id(),
    itemId: uuid("item_id").notNull().references(() => knowledgeItems.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    changedBy: uuid("changed_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("knowledge_item_versions_uq").on(t.itemId, t.version)],
);

export const sources = pgTable("sources", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  url: text("url"),
  publisher: text("publisher"),
  sourceType: text("source_type").$type<"vendor-official" | "standards-framework" | "community" | "internal-experience" | "unspecified">().notNull().default("unspecified"),
  fileKey: text("file_key"),
  checksum: text("checksum"),
  capturedAt: ts("captured_at").notNull().defaultNow(),
  lastVerifiedAt: ts("last_verified_at"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const knowledgeItemSources = pgTable(
  "knowledge_item_sources",
  {
    itemId: uuid("item_id").notNull().references(() => knowledgeItems.id, { onDelete: "cascade" }),
    // Sources are provenance: they cannot be deleted while a knowledge item cites them.
    sourceId: uuid("source_id").notNull().references(() => sources.id, { onDelete: "restrict" }),
    note: text("note"),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.sourceId] })],
);

export const sourceChunks = pgTable("source_chunks", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").references(() => sources.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").references(() => knowledgeItems.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull().default(0),
  content: text("content").notNull(),
  createdAt: createdAt(),
});

/** Embeddings are stored as plain float arrays so the app runs without pgvector. */
export const embeddings = pgTable(
  "embeddings",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => knowledgeItems.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    vector: real("vector").array().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("embeddings_item_model").on(t.itemId, t.provider, t.model)],
);

export const relationships = pgTable(
  "relationships",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    fromId: uuid("from_id").notNull().references(() => knowledgeItems.id, { onDelete: "cascade" }),
    toId: uuid("to_id").notNull().references(() => knowledgeItems.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provenance: text("provenance").notNull().default("human"),
    note: text("note"),
    confidence: real("confidence"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("relationships_uq").on(t.fromId, t.toId, t.type)],
);

// ── Projects & requirements ────────────────────────────────────────────────
export const projects = pgTable("projects", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  context: text("context").notNull().default(""),
  status: text("status").$type<"active" | "archived">().notNull().default("active"),
  requirementsStatus: text("requirements_status").$type<"none" | "draft" | "approved">().notNull().default("none"),
  requirementsApprovedAt: ts("requirements_approved_at"),
  weights: jsonb("weights").$type<FinderWeights | null>(),
  ownerId: uuid("owner_id").references(() => users.id),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const requirements = pgTable(
  "requirements",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    state: text("state").$type<IntakeField["state"]>().notNull().default("unknown"),
    value: text("value").notNull().default(""),
    tokens: text("tokens").array().notNull().default(sql`'{}'::text[]`),
    kind: text("kind").$type<"fact" | "assumption" | "unknown">().notNull().default("unknown"),
    evidence: text("evidence"),
    origin: text("origin").$type<"user" | "extracted">().notNull().default("user"),
    confidence: real("confidence"),
    question: text("question"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("requirements_project_field").on(t.projectId, t.field)],
);

export const environments = pgTable("environments", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").$type<"development" | "test" | "staging" | "production">().notNull().default("development"),
  platform: text("platform").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── Architecture ────────────────────────────────────────────────────────────
export const architectureCandidates = pgTable("architecture_candidates", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  run: integer("run").notNull(),
  rank: integer("rank").notNull(),
  scenarioId: uuid("scenario_id").references(() => knowledgeItems.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  label: text("label").$type<"exact-reference" | "adapted-reference" | "generated-proposal" | "assumption">().notNull(),
  score: real("score").notNull(),
  confidence: real("confidence").notNull(),
  factors: jsonb("factors").$type<CandidateFactor[]>().notNull(),
  weights: jsonb("weights").$type<FinderWeights>().notNull(),
  gaps: jsonb("gaps").$type<string[]>().notNull().default([]),
  tradeoffs: jsonb("tradeoffs").$type<string[]>().notNull().default([]),
  assumptions: jsonb("assumptions").$type<string[]>().notNull().default([]),
  costDrivers: jsonb("cost_drivers").$type<string[]>().notNull().default([]),
  matchReasons: jsonb("match_reasons").$type<string[]>().notNull().default([]),
  relatedItemIds: jsonb("related_item_ids").$type<string[]>().notNull().default([]),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
  diagram: jsonb("diagram").$type<DiagramModel>().notNull(),
  generator: text("generator").notNull().default("local-rules"),
  createdAt: createdAt(),
});

export const architectureRevisions = pgTable(
  "architecture_revisions",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").$type<"draft" | "approved" | "superseded">().notNull().default("draft"),
    title: text("title").notNull(),
    candidateId: uuid("candidate_id").references(() => architectureCandidates.id, { onDelete: "set null" }),
    scenarioId: uuid("scenario_id").references(() => knowledgeItems.id, { onDelete: "set null" }),
    label: text("label").notNull().default("adapted-reference"),
    sections: jsonb("sections").$type<BlueprintSection[]>().notNull().default([]),
    diagram: jsonb("diagram").$type<DiagramModel>().notNull(),
    sourceItemIds: jsonb("source_item_ids").$type<string[]>().notNull().default([]),
    lockVersion: integer("lock_version").notNull().default(1),
    contentHash: text("content_hash"),
    approvedAt: ts("approved_at"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvalNote: text("approval_note"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("architecture_revisions_uq").on(t.projectId, t.version)],
);

export const decisionRecords = pgTable(
  "decision_records",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id").references(() => architectureRevisions.id, { onDelete: "set null" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    status: text("status").$type<"proposed" | "accepted" | "superseded" | "rejected">().notNull().default("proposed"),
    context: text("context").notNull().default(""),
    decision: text("decision").notNull().default(""),
    alternatives: text("alternatives").notNull().default(""),
    consequences: text("consequences").notNull().default(""),
    candidateId: uuid("candidate_id").references(() => architectureCandidates.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("decision_records_uq").on(t.projectId, t.number)],
);

// ── Jobs, artifacts, manifests ──────────────────────────────────────────────
export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"artifacts" | "skills" | "deployment">().notNull(),
    status: text("status").$type<"queued" | "running" | "awaiting_approval" | "succeeded" | "failed" | "cancelled">().notNull().default("queued"),
    idempotencyKey: text("idempotency_key"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    error: text("error"),
    progress: jsonb("progress").$type<{ done: number; total: number; step?: string }>().notNull().default({ done: 0, total: 0 }),
    createdBy: uuid("created_by").references(() => users.id),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("generation_jobs_idem").on(t.projectId, t.idempotencyKey)],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    category: text("category").notNull(),
    name: text("name").notNull(),
    path: text("path").notNull(),
    format: text("format").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("artifacts_project_type").on(t.projectId, t.type)],
);

export const artifactRevisions = pgTable(
  "artifact_revisions",
  {
    id: id(),
    artifactId: uuid("artifact_id").notNull().references(() => artifacts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    architectureRevisionId: uuid("architecture_revision_id").notNull().references(() => architectureRevisions.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "set null" }),
    origin: text("origin").$type<"generated" | "user-edit">().notNull().default("generated"),
    reviewStatus: text("review_status").$type<"generated" | "reviewed">().notNull().default("generated"),
    content: text("content").notNull(),
    checksum: text("checksum").notNull(),
    templateVersion: text("template_version").notNull(),
    generator: text("generator").notNull(),
    sourceItemIds: jsonb("source_item_ids").$type<string[]>().notNull().default([]),
    assumptions: jsonb("assumptions").$type<string[]>().notNull().default([]),
    validation: jsonb("validation").$type<ArtifactValidation>().notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("artifact_revisions_uq").on(t.artifactId, t.version)],
);

export const generationManifests = pgTable("generation_manifests", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "set null" }),
  architectureRevisionId: uuid("architecture_revision_id").notNull().references(() => architectureRevisions.id, { onDelete: "restrict" }),
  body: jsonb("body").$type<GenerationManifestBody>().notNull(),
  hash: text("hash").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

// ── Skills ──────────────────────────────────────────────────────────────────
export const skills = pgTable(
  "skills",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<"platform" | "pattern" | "scenario" | "validation">().notNull(),
    title: text("title").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("skills_project_name").on(t.projectId, t.name)],
);

export const skillVersions = pgTable(
  "skill_versions",
  {
    id: id(),
    skillId: uuid("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    architectureRevisionId: uuid("architecture_revision_id").notNull().references(() => architectureRevisions.id, { onDelete: "restrict" }),
    origin: text("origin").$type<"generated" | "user-edit">().notNull().default("generated"),
    skillMd: text("skill_md").notNull(),
    files: jsonb("files").$type<SkillFile[]>().notNull().default([]),
    compatibility: jsonb("compatibility").$type<SkillCompatibility>().notNull(),
    sourceItemIds: jsonb("source_item_ids").$type<string[]>().notNull().default([]),
    validation: jsonb("validation").$type<SkillValidation>().notNull(),
    checksum: text("checksum").notNull(),
    generator: text("generator").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("skill_versions_uq").on(t.skillId, t.version)],
);

export const skillDependencies = pgTable(
  "skill_dependencies",
  {
    skillId: uuid("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
    dependsOnId: uuid("depends_on_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
    reason: text("reason").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.skillId, t.dependsOnId] })],
);

export const skillPackages = pgTable(
  "skill_packages",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    architectureRevisionId: uuid("architecture_revision_id").notNull().references(() => architectureRevisions.id, { onDelete: "restrict" }),
    skillVersionIds: jsonb("skill_version_ids").$type<string[]>().notNull(),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    checksum: text("checksum").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("skill_packages_uq").on(t.projectId, t.version)],
);

// ── Deployment ──────────────────────────────────────────────────────────────
export const deploymentPlans = pgTable("deployment_plans", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  environmentId: uuid("environment_id").notNull().references(() => environments.id, { onDelete: "restrict" }),
  manifestId: uuid("manifest_id").notNull().references(() => generationManifests.id, { onDelete: "restrict" }),
  architectureRevisionId: uuid("architecture_revision_id").notNull().references(() => architectureRevisions.id, { onDelete: "restrict" }),
  adapter: text("adapter").notNull(),
  body: jsonb("body").$type<DeploymentPlanBody>().notNull(),
  planHash: text("plan_hash").notNull(),
  status: text("status").$type<"planned" | "superseded">().notNull().default("planned"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const approvals = pgTable("approvals", {
  id: id(),
  planId: uuid("plan_id").notNull().references(() => deploymentPlans.id, { onDelete: "restrict" }),
  planHash: text("plan_hash").notNull(),
  environmentId: uuid("environment_id").notNull().references(() => environments.id, { onDelete: "restrict" }),
  scope: jsonb("scope").$type<ApprovalScope>().notNull(),
  status: text("status").$type<"approved" | "revoked" | "consumed">().notNull().default("approved"),
  note: text("note").notNull().default(""),
  approvedBy: uuid("approved_by").notNull().references(() => users.id),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
});

export const deploymentRuns = pgTable("deployment_runs", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => deploymentPlans.id, { onDelete: "restrict" }),
  approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "restrict" }),
  mode: text("mode").$type<"dry-run" | "execute">().notNull().default("dry-run"),
  status: text("status").$type<"queued" | "running" | "succeeded" | "failed" | "cancelled">().notNull().default("queued"),
  adapter: text("adapter").notNull(),
  simulated: boolean("simulated").notNull().default(true),
  planHash: text("plan_hash").notNull(),
  log: jsonb("log").$type<RunLogEntry[]>().notNull().default([]),
  summary: text("summary"),
  startedBy: uuid("started_by").references(() => users.id),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
  createdAt: createdAt(),
});

export const validationChecks = pgTable("validation_checks", {
  id: id(),
  runId: uuid("run_id").notNull().references(() => deploymentRuns.id, { onDelete: "restrict" }),
  level: text("level").$type<"static" | "preflight" | "deployment" | "functional" | "security" | "operational">().notNull(),
  name: text("name").notNull(),
  status: text("status").$type<"passed" | "failed" | "warning" | "skipped">().notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: createdAt(),
});

/** Evidence is append-only: no update or delete path exists in the services. */
export const evidenceRecords = pgTable("evidence_records", {
  id: id(),
  runId: uuid("run_id").notNull().references(() => deploymentRuns.id, { onDelete: "restrict" }),
  checkId: uuid("check_id").references(() => validationChecks.id, { onDelete: "restrict" }),
  actor: text("actor").notNull(),
  environment: text("environment").notNull(),
  planHash: text("plan_hash").notNull(),
  tool: text("tool").notNull(),
  command: text("command").notNull(),
  exitCode: integer("exit_code"),
  output: text("output").notNull().default(""),
  result: text("result").notNull(),
  simulated: boolean("simulated").notNull().default(false),
  resourceIds: jsonb("resource_ids").$type<string[]>().notNull().default([]),
  artifactRefs: jsonb("artifact_refs").$type<string[]>().notNull().default([]),
  architectureRevisionId: uuid("architecture_revision_id").references(() => architectureRevisions.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
});

// ── Audit ───────────────────────────────────────────────────────────────────
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    projectId: uuid("project_id"),
    summary: text("summary").notNull().default(""),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    correlationId: text("correlation_id"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_ws_time").on(t.workspaceId, t.createdAt)],
);
