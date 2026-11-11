import { z } from "zod";
import {
  CHECKLIST_ITEM_TYPES,
  EVIDENCE_TYPES,
  evidenceUrlProblem,
  LIFECYCLE_STATUSES,
  MILESTONE_STATUSES,
  READINESS_RULES,
  RISK_CATEGORIES,
  RISK_STATUSES,
} from "./lifecycle";

const trimmed = (max: number) => z.string().trim().max(max);
const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();

/** A calendar day (`YYYY-MM-DD`) or a full ISO timestamp; stored as a timestamp. Null clears the date. */
const dateInput = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD."), z.string().datetime({ offset: true })])
  .transform((value, ctx) => {
    const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
    const year = date.getUTCFullYear();
    if (Number.isNaN(date.getTime()) || year < 2000 || year > 2100) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date between 2000 and 2100." });
      return z.NEVER;
    }
    return date;
  })
  .nullable();

/** Unknown rule keys are rejected, never ignored. */
export const readinessRulesSchema = z.array(z.enum(READINESS_RULES, { error: "Unknown readiness rule." })).max(READINESS_RULES.length);

const stageKey = z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, "Use 2–40 lowercase letters, digits or underscores, starting with a letter.");

export const templateChecklistSchema = z.object({
  title: trimmed(300).min(3, "Describe the checklist item in at least 3 characters."),
  description: trimmed(1000).default(""),
  itemType: z.enum(CHECKLIST_ITEM_TYPES).default("task"),
  isRequired: z.boolean().default(true),
});

export const templateStageSchema = z.object({
  stageKey,
  name: trimmed(80).min(2, "Stage name must be at least 2 characters."),
  description: trimmed(600).default(""),
  isRequired: z.boolean().default(true),
  requiresApproval: z.boolean().default(true),
  defaultDurationDays: z.number().int().min(1).max(3650).nullable().default(null),
  readinessRules: readinessRulesSchema.default([]),
  checklist: z.array(templateChecklistSchema).max(60).default([]),
});

const stagesSchema = z
  .array(templateStageSchema)
  .min(1, "A template needs at least one stage.")
  .max(20)
  .superRefine((stages, ctx) => {
    const seen = new Set<string>();
    stages.forEach((stage, index) => {
      if (seen.has(stage.stageKey)) ctx.addIssue({ code: "custom", message: `Stage key “${stage.stageKey}” is used more than once.`, path: [index, "stageKey"] });
      seen.add(stage.stageKey);
    });
    if (!stages.some((s) => s.isRequired)) ctx.addIssue({ code: "custom", message: "At least one stage must be required." });
  });

export const templateCreateSchema = z.object({
  name: trimmed(120).min(3, "Name must be at least 3 characters."),
  description: trimmed(600).default(""),
  /** Copy the stages and checklists of this template. Omit both this and `stages` to copy the workspace default. */
  fromTemplateId: uuid.optional(),
  stages: stagesSchema.optional(),
});

export const templateUpdateSchema = z.object({
  name: trimmed(120).min(3, "Name must be at least 3 characters."),
  description: trimmed(600).default(""),
  stages: stagesSchema,
  /** The version the editor loaded; a stale save is rejected. */
  expectedVersion: z.number().int().min(1),
});

export const templateActiveSchema = z.object({ isActive: z.boolean() });

export const lifecycleInitSchema = z.object({ templateId: uuid.optional() });

export const lifecycleUpdateSchema = z
  .object({
    status: z.enum(LIFECYCLE_STATUSES).exclude(["not_started"]).optional(),
    targetEndAt: dateInput.optional(),
    note: trimmed(1000).optional(),
  })
  .refine((v) => v.status !== undefined || v.targetEndAt !== undefined, "Nothing to update.");

export const stageUpdateSchema = z
  .object({
    ownerId: nullableUuid.optional(),
    reviewerId: nullableUuid.optional(),
    dueAt: dateInput.optional(),
    notes: z.string().max(4000).optional(),
    /** Optional status change; validated against the transition rules on the server. */
    status: z.enum(["in_progress", "blocked", "completed", "skipped"]).optional(),
    reason: trimmed(1000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");

const reason = (message: string) => z.object({ reason: trimmed(1000).min(3, message) });
export const stageBlockSchema = reason("Say what is blocking the stage.");
export const stageReopenSchema = reason("Say why the stage is being reopened.");
export const stageSkipSchema = reason("Say why the stage is being skipped.");
export const stageCompleteSchema = z.object({ completionNote: trimmed(2000).optional() });

export const checklistCreateSchema = z.object({
  title: trimmed(300).min(3, "Describe the checklist item in at least 3 characters."),
  description: trimmed(1000).default(""),
  itemType: z.enum(CHECKLIST_ITEM_TYPES).default("task"),
  isRequired: z.boolean().default(false),
  assigneeId: nullableUuid.optional(),
  dueAt: dateInput.optional(),
});

export const checklistUpdateSchema = z
  .object({
    title: trimmed(300).min(3, "Describe the checklist item in at least 3 characters.").optional(),
    description: trimmed(1000).optional(),
    /** Waiving has its own endpoint because it needs a reason. */
    status: z.enum(["pending", "in_progress", "completed"]).optional(),
    assigneeId: nullableUuid.optional(),
    dueAt: dateInput.optional(),
    notes: z.string().max(4000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");

export const checklistWaiveSchema = reason("Say why this item is being waived.");

export const evidenceCreateSchema = z
  .object({
    evidenceType: z.enum(EVIDENCE_TYPES),
    title: trimmed(200).min(3, "Give the evidence a title of at least 3 characters."),
    checklistItemId: nullableUuid.optional(),
    artifactId: uuid.optional(),
    artifactRevisionId: uuid.optional(),
    url: z.string().trim().optional(),
    note: z.string().trim().max(4000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.evidenceType === "artifact" && !v.artifactId) ctx.addIssue({ code: "custom", message: "Choose a generated artifact.", path: ["artifactId"] });
    if (v.evidenceType !== "artifact" && (v.artifactId || v.artifactRevisionId)) ctx.addIssue({ code: "custom", message: "Only artifact evidence can link an artifact.", path: ["artifactId"] });
    if (v.evidenceType === "url") {
      const problem = evidenceUrlProblem(v.url ?? "");
      if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["url"] });
    } else if (v.url) ctx.addIssue({ code: "custom", message: "Only URL evidence can carry a link.", path: ["url"] });
    if (v.evidenceType === "note" && !v.note) ctx.addIssue({ code: "custom", message: "Write the note.", path: ["note"] });
  });

export const evidenceSupersedeSchema = reason("Say why this evidence is being superseded.");

export const approvalRequestSchema = z.object({
  /** Defaults to the stage's assigned reviewer. */
  reviewerId: uuid.optional(),
  note: trimmed(2000).min(3, "Say what you are asking the reviewer to approve."),
});
export const approvalApproveSchema = z.object({ note: trimmed(2000).default("") });
export const approvalRejectSchema = z.object({ note: trimmed(2000).min(3, "Tell the requester what has to change.") });
export const approvalWithdrawSchema = z.object({ note: trimmed(2000).default("") });

const milestoneFields = {
  name: trimmed(160).min(3, "Name must be at least 3 characters."),
  description: trimmed(2000),
  status: z.enum(MILESTONE_STATUSES),
  ownerId: nullableUuid,
  dueAt: dateInput,
};
export const milestoneCreateSchema = z.object({
  name: milestoneFields.name,
  description: milestoneFields.description.default(""),
  status: milestoneFields.status.default("planned"),
  ownerId: milestoneFields.ownerId.default(null),
  dueAt: milestoneFields.dueAt.default(null),
});
export const milestoneUpdateSchema = z.object(milestoneFields).partial().refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");

const score = (label: string) => z.number({ error: `${label} must be a whole number from 1 to 5.` }).int(`${label} must be a whole number from 1 to 5.`).min(1, `${label} must be at least 1.`).max(5, `${label} must be at most 5.`);
const riskFields = {
  title: trimmed(200).min(3, "Title must be at least 3 characters."),
  description: trimmed(4000),
  category: z.enum(RISK_CATEGORIES),
  likelihood: score("Likelihood"),
  impact: score("Impact"),
  status: z.enum(RISK_STATUSES),
  ownerId: nullableUuid,
  mitigation: trimmed(4000),
  dueAt: dateInput,
};
/** `.strict()`: a client-supplied `severity` is rejected — the score is always derived on the server. */
export const riskCreateSchema = z
  .object({
    title: riskFields.title,
    description: riskFields.description.default(""),
    category: riskFields.category.default("delivery"),
    likelihood: riskFields.likelihood,
    impact: riskFields.impact,
    status: riskFields.status.default("open"),
    ownerId: riskFields.ownerId.default(null),
    mitigation: riskFields.mitigation.default(""),
    dueAt: riskFields.dueAt.default(null),
  })
  .strict();
export const riskUpdateSchema = z.object(riskFields).partial().strict().refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");

export type TemplateStageInput = z.infer<typeof templateStageSchema>;
export type TemplateCreateInput = z.infer<typeof templateCreateSchema>;
export type TemplateUpdateInput = z.infer<typeof templateUpdateSchema>;
export type StageUpdateInput = z.infer<typeof stageUpdateSchema>;
export type ChecklistCreateInput = z.infer<typeof checklistCreateSchema>;
export type ChecklistUpdateInput = z.infer<typeof checklistUpdateSchema>;
export type EvidenceCreateInput = z.infer<typeof evidenceCreateSchema>;
export type MilestoneCreateInput = z.infer<typeof milestoneCreateSchema>;
export type MilestoneUpdateInput = z.infer<typeof milestoneUpdateSchema>;
export type RiskCreateInput = z.infer<typeof riskCreateSchema>;
export type RiskUpdateInput = z.infer<typeof riskUpdateSchema>;
