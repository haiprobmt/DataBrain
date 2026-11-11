CREATE TABLE "lifecycle_checklist_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_definition_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"item_type" text DEFAULT 'task' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifecycle_stage_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"default_duration_days" integer,
	"readiness_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifecycle_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"stage_instance_id" uuid NOT NULL,
	"definition_id" uuid,
	"origin" text DEFAULT 'template' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer NOT NULL,
	"is_required" boolean NOT NULL,
	"item_type" text DEFAULT 'task' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"assignee_id" uuid,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"waived_reason" text,
	"status_changed_by" uuid,
	"status_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_lifecycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_name" text NOT NULL,
	"template_version" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone,
	"target_end_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"owner_id" uuid,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'delivery' NOT NULL,
	"likelihood" integer NOT NULL,
	"impact" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"owner_id" uuid,
	"mitigation" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_risks_likelihood_range" CHECK ("project_risks"."likelihood" between 1 and 5),
	CONSTRAINT "project_risks_impact_range" CHECK ("project_risks"."impact" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "project_stage_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_lifecycle_id" uuid NOT NULL,
	"stage_definition_id" uuid,
	"stage_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer NOT NULL,
	"is_required" boolean NOT NULL,
	"requires_approval" boolean NOT NULL,
	"default_duration_days" integer,
	"readiness_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"owner_id" uuid,
	"reviewer_id" uuid,
	"start_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"blocked_reason" text,
	"completion_note" text,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"stage_instance_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"request_note" text DEFAULT '' NOT NULL,
	"decision_note" text,
	"decided_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"invalidated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"stage_instance_id" uuid NOT NULL,
	"checklist_item_id" uuid,
	"artifact_id" uuid,
	"artifact_revision_id" uuid,
	"title" text NOT NULL,
	"evidence_type" text NOT NULL,
	"url" text,
	"note" text,
	"superseded_at" timestamp with time zone,
	"superseded_by" uuid,
	"superseded_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lifecycle_checklist_definitions" ADD CONSTRAINT "lifecycle_checklist_definitions_stage_definition_id_lifecycle_stage_definitions_id_fk" FOREIGN KEY ("stage_definition_id") REFERENCES "public"."lifecycle_stage_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_stage_definitions" ADD CONSTRAINT "lifecycle_stage_definitions_template_id_lifecycle_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."lifecycle_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_templates" ADD CONSTRAINT "lifecycle_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_templates" ADD CONSTRAINT "lifecycle_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_stage_instance_id_project_stage_instances_id_fk" FOREIGN KEY ("stage_instance_id") REFERENCES "public"."project_stage_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_definition_id_lifecycle_checklist_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."lifecycle_checklist_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_lifecycles" ADD CONSTRAINT "project_lifecycles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_lifecycles" ADD CONSTRAINT "project_lifecycles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_lifecycles" ADD CONSTRAINT "project_lifecycles_template_id_lifecycle_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."lifecycle_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_lifecycles" ADD CONSTRAINT "project_lifecycles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_instances" ADD CONSTRAINT "project_stage_instances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_instances" ADD CONSTRAINT "project_stage_instances_project_lifecycle_id_project_lifecycles_id_fk" FOREIGN KEY ("project_lifecycle_id") REFERENCES "public"."project_lifecycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_instances" ADD CONSTRAINT "project_stage_instances_stage_definition_id_lifecycle_stage_definitions_id_fk" FOREIGN KEY ("stage_definition_id") REFERENCES "public"."lifecycle_stage_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_instances" ADD CONSTRAINT "project_stage_instances_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_instances" ADD CONSTRAINT "project_stage_instances_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_approvals" ADD CONSTRAINT "stage_approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_approvals" ADD CONSTRAINT "stage_approvals_stage_instance_id_project_stage_instances_id_fk" FOREIGN KEY ("stage_instance_id") REFERENCES "public"."project_stage_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_approvals" ADD CONSTRAINT "stage_approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_approvals" ADD CONSTRAINT "stage_approvals_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_approvals" ADD CONSTRAINT "stage_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_evidence" ADD CONSTRAINT "stage_evidence_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_evidence" ADD CONSTRAINT "stage_evidence_stage_instance_id_project_stage_instances_id_fk" FOREIGN KEY ("stage_instance_id") REFERENCES "public"."project_stage_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_evidence" ADD CONSTRAINT "stage_evidence_checklist_item_id_project_checklist_items_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "public"."project_checklist_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_evidence" ADD CONSTRAINT "stage_evidence_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_evidence" ADD CONSTRAINT "stage_evidence_artifact_revision_id_artifact_revisions_id_fk" FOREIGN KEY ("artifact_revision_id") REFERENCES "public"."artifact_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_evidence" ADD CONSTRAINT "stage_evidence_superseded_by_users_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_evidence" ADD CONSTRAINT "stage_evidence_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lifecycle_checklist_definitions_stage" ON "lifecycle_checklist_definitions" USING btree ("stage_definition_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_stage_definitions_key" ON "lifecycle_stage_definitions" USING btree ("template_id","stage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_stage_definitions_order" ON "lifecycle_stage_definitions" USING btree ("template_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_templates_ws_name" ON "lifecycle_templates" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_templates_ws_default" ON "lifecycle_templates" USING btree ("workspace_id") WHERE "lifecycle_templates"."is_default" and "lifecycle_templates"."is_active";--> statement-breakpoint
CREATE INDEX "project_checklist_items_stage" ON "project_checklist_items" USING btree ("stage_instance_id","sort_order");--> statement-breakpoint
CREATE INDEX "project_checklist_items_ws_status_due" ON "project_checklist_items" USING btree ("workspace_id","status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_lifecycles_project" ON "project_lifecycles" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_lifecycles_ws_status" ON "project_lifecycles" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "project_milestones_project" ON "project_milestones" USING btree ("project_id","due_at");--> statement-breakpoint
CREATE INDEX "project_milestones_ws_status_due" ON "project_milestones" USING btree ("workspace_id","status","due_at");--> statement-breakpoint
CREATE INDEX "project_risks_project" ON "project_risks" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "project_risks_ws_status" ON "project_risks" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_stage_instances_key" ON "project_stage_instances" USING btree ("project_lifecycle_id","stage_key");--> statement-breakpoint
CREATE INDEX "project_stage_instances_ws_status_due" ON "project_stage_instances" USING btree ("workspace_id","status","due_at");--> statement-breakpoint
CREATE INDEX "project_stage_instances_order" ON "project_stage_instances" USING btree ("project_lifecycle_id","sort_order");--> statement-breakpoint
CREATE INDEX "stage_approvals_stage" ON "stage_approvals" USING btree ("stage_instance_id","requested_at");--> statement-breakpoint
CREATE INDEX "stage_approvals_ws_status" ON "stage_approvals" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_approvals_open" ON "stage_approvals" USING btree ("stage_instance_id") WHERE "stage_approvals"."status" = 'requested';--> statement-breakpoint
CREATE INDEX "stage_evidence_stage" ON "stage_evidence" USING btree ("stage_instance_id","created_at");