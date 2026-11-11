CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_hash" text NOT NULL,
	"environment_id" uuid NOT NULL,
	"scope" jsonb NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"approved_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "architecture_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"run" integer NOT NULL,
	"rank" integer NOT NULL,
	"scenario_id" uuid,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"label" text NOT NULL,
	"score" real NOT NULL,
	"confidence" real NOT NULL,
	"factors" jsonb NOT NULL,
	"weights" jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tradeoffs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost_drivers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"diagram" jsonb NOT NULL,
	"generator" text DEFAULT 'local-rules' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "architecture_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"candidate_id" uuid,
	"scenario_id" uuid,
	"label" text DEFAULT 'adapted-reference' NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"diagram" jsonb NOT NULL,
	"source_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lock_version" integer DEFAULT 1 NOT NULL,
	"content_hash" text,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"approval_note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"architecture_revision_id" uuid NOT NULL,
	"job_id" uuid,
	"origin" text DEFAULT 'generated' NOT NULL,
	"review_status" text DEFAULT 'generated' NOT NULL,
	"content" text NOT NULL,
	"checksum" text NOT NULL,
	"template_version" text NOT NULL,
	"generator" text NOT NULL,
	"source_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"format" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"project_id" uuid,
	"summary" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"revision_id" uuid,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"decision" text DEFAULT '' NOT NULL,
	"alternatives" text DEFAULT '' NOT NULL,
	"consequences" text DEFAULT '' NOT NULL,
	"candidate_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"manifest_id" uuid NOT NULL,
	"architecture_revision_id" uuid NOT NULL,
	"adapter" text NOT NULL,
	"body" jsonb NOT NULL,
	"plan_hash" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"approval_id" uuid,
	"mode" text DEFAULT 'dry-run' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"adapter" text NOT NULL,
	"simulated" boolean DEFAULT true NOT NULL,
	"plan_hash" text NOT NULL,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"started_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"vector" real[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'development' NOT NULL,
	"platform" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"check_id" uuid,
	"actor" text NOT NULL,
	"environment" text NOT NULL,
	"plan_hash" text NOT NULL,
	"tool" text NOT NULL,
	"command" text NOT NULL,
	"exit_code" integer,
	"output" text DEFAULT '' NOT NULL,
	"result" text NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"resource_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"architecture_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"progress" jsonb DEFAULT '{"done":0,"total":0}'::jsonb NOT NULL,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"job_id" uuid,
	"architecture_revision_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_item_sources" (
	"item_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"note" text,
	CONSTRAINT "knowledge_item_sources_item_id_source_id_pk" PRIMARY KEY("item_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_item_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"origin" text DEFAULT 'human' NOT NULL,
	"source_type" text DEFAULT 'unspecified' NOT NULL,
	"confidence" real,
	"version" integer DEFAULT 1 NOT NULL,
	"author_id" uuid,
	"reviewer_id" uuid,
	"reviewed_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title,'')), 'A') || setweight(to_tsvector('english', coalesce(summary,'')), 'B') || setweight(to_tsvector('english', coalesce(search_text,'')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_workspace_id_pk" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"requirements_status" text DEFAULT 'none' NOT NULL,
	"requirements_approved_at" timestamp with time zone,
	"weights" jsonb,
	"owner_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provenance" text DEFAULT 'human' NOT NULL,
	"note" text,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"field" text NOT NULL,
	"state" text DEFAULT 'unknown' NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"tokens" text[] DEFAULT '{}'::text[] NOT NULL,
	"kind" text DEFAULT 'unknown' NOT NULL,
	"evidence" text,
	"origin" text DEFAULT 'user' NOT NULL,
	"confidence" real,
	"question" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_dependencies" (
	"skill_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	CONSTRAINT "skill_dependencies_skill_id_depends_on_id_pk" PRIMARY KEY("skill_id","depends_on_id")
);
--> statement-breakpoint
CREATE TABLE "skill_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"architecture_revision_id" uuid NOT NULL,
	"skill_version_ids" jsonb NOT NULL,
	"manifest" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"architecture_revision_id" uuid NOT NULL,
	"origin" text DEFAULT 'generated' NOT NULL,
	"skill_md" text NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"compatibility" jsonb NOT NULL,
	"source_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"generator" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid,
	"item_id" uuid,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"publisher" text,
	"source_type" text DEFAULT 'unspecified' NOT NULL,
	"file_key" text,
	"checksum" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "validation_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"level" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_plan_id_deployment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."deployment_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_candidates" ADD CONSTRAINT "architecture_candidates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_candidates" ADD CONSTRAINT "architecture_candidates_scenario_id_knowledge_items_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."knowledge_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_revisions" ADD CONSTRAINT "architecture_revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_revisions" ADD CONSTRAINT "architecture_revisions_candidate_id_architecture_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."architecture_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_revisions" ADD CONSTRAINT "architecture_revisions_scenario_id_knowledge_items_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."knowledge_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_revisions" ADD CONSTRAINT "architecture_revisions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_revisions" ADD CONSTRAINT "architecture_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_revisions" ADD CONSTRAINT "artifact_revisions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_revisions" ADD CONSTRAINT "artifact_revisions_architecture_revision_id_architecture_revisions_id_fk" FOREIGN KEY ("architecture_revision_id") REFERENCES "public"."architecture_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_revisions" ADD CONSTRAINT "artifact_revisions_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_revisions" ADD CONSTRAINT "artifact_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_revision_id_architecture_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."architecture_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_candidate_id_architecture_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."architecture_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_plans" ADD CONSTRAINT "deployment_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_plans" ADD CONSTRAINT "deployment_plans_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_plans" ADD CONSTRAINT "deployment_plans_manifest_id_generation_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."generation_manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_plans" ADD CONSTRAINT "deployment_plans_architecture_revision_id_architecture_revisions_id_fk" FOREIGN KEY ("architecture_revision_id") REFERENCES "public"."architecture_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_plans" ADD CONSTRAINT "deployment_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_runs" ADD CONSTRAINT "deployment_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_runs" ADD CONSTRAINT "deployment_runs_plan_id_deployment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."deployment_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_runs" ADD CONSTRAINT "deployment_runs_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_runs" ADD CONSTRAINT "deployment_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_item_id_knowledge_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_run_id_deployment_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."deployment_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_check_id_validation_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."validation_checks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_architecture_revision_id_architecture_revisions_id_fk" FOREIGN KEY ("architecture_revision_id") REFERENCES "public"."architecture_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_manifests" ADD CONSTRAINT "generation_manifests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_manifests" ADD CONSTRAINT "generation_manifests_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_manifests" ADD CONSTRAINT "generation_manifests_architecture_revision_id_architecture_revisions_id_fk" FOREIGN KEY ("architecture_revision_id") REFERENCES "public"."architecture_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_manifests" ADD CONSTRAINT "generation_manifests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_sources" ADD CONSTRAINT "knowledge_item_sources_item_id_knowledge_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_sources" ADD CONSTRAINT "knowledge_item_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_versions" ADD CONSTRAINT "knowledge_item_versions_item_id_knowledge_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_versions" ADD CONSTRAINT "knowledge_item_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_from_id_knowledge_items_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_to_id_knowledge_items_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_dependencies" ADD CONSTRAINT "skill_dependencies_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_dependencies" ADD CONSTRAINT "skill_dependencies_depends_on_id_skills_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_packages" ADD CONSTRAINT "skill_packages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_packages" ADD CONSTRAINT "skill_packages_architecture_revision_id_architecture_revisions_id_fk" FOREIGN KEY ("architecture_revision_id") REFERENCES "public"."architecture_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_packages" ADD CONSTRAINT "skill_packages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_architecture_revision_id_architecture_revisions_id_fk" FOREIGN KEY ("architecture_revision_id") REFERENCES "public"."architecture_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_item_id_knowledge_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_checks" ADD CONSTRAINT "validation_checks_run_id_deployment_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."deployment_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "architecture_revisions_uq" ON "architecture_revisions" USING btree ("project_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_revisions_uq" ON "artifact_revisions" USING btree ("artifact_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_project_type" ON "artifacts" USING btree ("project_id","type");--> statement-breakpoint
CREATE INDEX "audit_events_ws_time" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_records_uq" ON "decision_records" USING btree ("project_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_item_model" ON "embeddings" USING btree ("item_id","provider","model");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_idem" ON "generation_jobs" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_item_versions_uq" ON "knowledge_item_versions" USING btree ("item_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_items_ws_slug" ON "knowledge_items" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "knowledge_items_search" ON "knowledge_items" USING gin ("search");--> statement-breakpoint
CREATE INDEX "knowledge_items_type" ON "knowledge_items" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "relationships_uq" ON "relationships" USING btree ("from_id","to_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "requirements_project_field" ON "requirements" USING btree ("project_id","field");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_packages_uq" ON "skill_packages" USING btree ("project_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_uq" ON "skill_versions" USING btree ("skill_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_project_name" ON "skills" USING btree ("project_id","name");