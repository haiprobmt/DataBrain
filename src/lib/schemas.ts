import { z } from "zod";
import { KNOWLEDGE_TYPE_KEYS, RELATIONSHIP_TYPES, SOURCE_TYPE_KEYS } from "./catalog";
import { FACTOR_KEYS } from "./types";

const trimmed = (max: number) => z.string().trim().max(max);
const uuid = z.string().uuid();

export const sectionSchema = z.object({ key: trimmed(60).min(1), title: trimmed(120).min(1), body: z.string().max(20000) });

const provenanceSchema = z.object({
  origin: z.enum(["reference", "adapted", "generated", "assumption", "user"]),
  itemId: uuid.optional(),
  note: trimmed(500).optional(),
});

export const diagramSchema = z
  .object({
    nodes: z
      .array(
        z.object({
          id: trimmed(80).min(1),
          kind: z.enum(["source", "ingestion", "storage", "processing", "serving", "consumer", "security", "governance", "network", "operations", "other"]),
          label: trimmed(120).min(1, "Every component needs a label."),
          description: z.string().max(2000),
          technology: trimmed(120).optional(),
          config: z.record(trimmed(80), trimmed(500)),
          provenance: provenanceSchema,
          requirementFields: z.array(trimmed(60)).max(30),
          position: z.object({ x: z.number().finite(), y: z.number().finite() }),
        }),
      )
      .max(200),
    edges: z
      .array(
        z.object({
          id: trimmed(120).min(1),
          source: trimmed(80).min(1),
          target: trimmed(80).min(1),
          label: trimmed(120),
          kind: z.enum(["data", "control", "network"]),
          description: z.string().max(1000).optional(),
          provenance: provenanceSchema,
        }),
      )
      .max(400),
  })
  .superRefine((diagram, ctx) => {
    const ids = new Set<string>();
    for (const node of diagram.nodes) {
      if (ids.has(node.id)) ctx.addIssue({ code: "custom", message: `Duplicate component id "${node.id}".`, path: ["nodes"] });
      ids.add(node.id);
    }
    const edgeIds = new Set<string>();
    for (const edge of diagram.edges) {
      if (edgeIds.has(edge.id)) ctx.addIssue({ code: "custom", message: `Duplicate connection id "${edge.id}".`, path: ["edges"] });
      edgeIds.add(edge.id);
      if (!ids.has(edge.source) || !ids.has(edge.target)) {
        ctx.addIssue({ code: "custom", message: `Connection "${edge.id}" points at a component that does not exist.`, path: ["edges"] });
      }
      if (edge.source === edge.target) ctx.addIssue({ code: "custom", message: `Connection "${edge.id}" connects a component to itself.`, path: ["edges"] });
    }
  });

const attributesSchema = z
  .object({
    platforms: z.array(trimmed(60)).max(30),
    clouds: z.array(trimmed(60)).max(10),
    workloads: z.array(trimmed(60)).max(30),
    latency: z.array(trimmed(60)).max(10),
    sourceSystems: z.array(trimmed(60)).max(40),
    security: z.array(trimmed(60)).max(40),
    skills: z.array(trimmed(60)).max(40),
    complexity: z.number().int().min(1).max(5),
    migrationEffort: z.number().int().min(1).max(5),
    costDrivers: z.array(trimmed(300)).max(30),
    costModel: z.enum(["consumption", "provisioned", "mixed"]),
    tradeoffs: z.array(trimmed(300)).max(30),
    limitations: z.array(trimmed(300)).max(30),
    diagram: diagramSchema,
    vendor: trimmed(120),
    category: trimmed(120),
    compare: z.record(trimmed(80), trimmed(600)),
    strategy: trimmed(60),
    steps: z.array(trimmed(500)).max(60),
    projectId: uuid,
  })
  .partial();

export const knowledgeInputSchema = z.object({
  title: trimmed(160).min(3, "Title must be at least 3 characters."),
  type: z.enum(KNOWLEDGE_TYPE_KEYS),
  summary: trimmed(1200).min(1, "Add a one-paragraph summary."),
  sections: z.array(sectionSchema).max(30).default([]),
  attributes: attributesSchema.default({}),
  tags: z.array(trimmed(40).min(1)).max(20).default([]),
  sourceType: z.enum(SOURCE_TYPE_KEYS).default("unspecified"),
  confidence: z.number().min(0).max(1).nullable().default(null),
});
export type KnowledgeInput = z.infer<typeof knowledgeInputSchema>;

export const knowledgeUpdateSchema = knowledgeInputSchema.extend({
  expectedVersion: z.number().int().min(1),
  /** Required to edit an item whose status is "verified": the edit returns it to draft. */
  confirmVerifiedEdit: z.boolean().default(false),
});

export const statusChangeSchema = z.object({ status: z.enum(["draft", "reviewed", "verified", "archived"]) });

export const sourceInputSchema = z.object({
  title: trimmed(200).min(2, "Give the source a title."),
  url: z.union([z.literal(""), z.string().trim().url("Enter a full URL, including https://").max(600)]).default(""),
  publisher: trimmed(120).default(""),
  sourceType: z.enum(SOURCE_TYPE_KEYS).default("unspecified"),
  /** Attach the new source to this knowledge item. */
  itemId: uuid.optional(),
  note: trimmed(300).optional(),
});

export const relationshipInputSchema = z.object({
  fromId: uuid,
  toId: uuid,
  type: z.enum(RELATIONSHIP_TYPES),
  note: trimmed(300).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const importSchema = z.object({
  fileName: trimmed(200).min(1),
  content: z.string().min(20, "The document is too short to import.").max(400_000, "Documents are limited to 400,000 characters."),
  type: z.enum(KNOWLEDGE_TYPE_KEYS).default("concept"),
  sourceType: z.enum(SOURCE_TYPE_KEYS).default("unspecified"),
  url: z.union([z.literal(""), z.string().trim().url().max(600)]).default(""),
});

export const projectInputSchema = z.object({
  name: trimmed(120).min(3, "Name must be at least 3 characters."),
  description: trimmed(600).default(""),
  context: z.string().max(20000).default(""),
});

export const requirementInputSchema = z.object({
  field: trimmed(60).min(1),
  state: z.enum(["known", "unknown", "not-applicable"]),
  value: trimmed(2000).default(""),
  kind: z.enum(["fact", "assumption", "unknown"]).optional(),
});
export const requirementsSaveSchema = z.object({ requirements: z.array(requirementInputSchema).max(60) });

export const weightsSchema = z
  .object(Object.fromEntries(FACTOR_KEYS.map((k) => [k, z.number().min(0).max(100)])) as Record<(typeof FACTOR_KEYS)[number], z.ZodNumber>)
  .refine((w) => Object.values(w).some((v) => v > 0), "At least one weight must be above zero.");

export const finderRunSchema = z.object({ weights: weightsSchema.optional() });

export const environmentInputSchema = z.object({
  name: trimmed(80).min(2, "Name must be at least 2 characters."),
  kind: z.enum(["development", "test", "staging", "production"]),
  platform: trimmed(120).default(""),
  notes: trimmed(1000).default(""),
});

export const blueprintSectionSchema = z.object({
  key: trimmed(60).min(1),
  title: trimmed(160).min(1),
  body: z.string().max(40000),
  origin: z.enum(["reference", "adapted", "generated", "assumption", "user"]),
  edited: z.boolean(),
});

export const revisionCreateSchema = z.union([
  z.object({ candidateId: uuid }),
  z.object({ fromRevisionId: uuid }),
]);

export const revisionUpdateSchema = z.object({
  lockVersion: z.number().int().min(1),
  title: trimmed(200).min(3).optional(),
  sections: z.array(blueprintSectionSchema).max(40).optional(),
  diagram: diagramSchema.optional(),
});

export const approveSchema = z.object({ lockVersion: z.number().int().min(1), note: trimmed(1000).default("") });

export const decisionInputSchema = z.object({
  title: trimmed(200).min(3, "Title must be at least 3 characters."),
  status: z.enum(["proposed", "accepted", "superseded", "rejected"]).default("proposed"),
  context: z.string().max(8000).default(""),
  decision: z.string().max(8000).min(1, "Record what was decided."),
  alternatives: z.string().max(8000).default(""),
  consequences: z.string().max(8000).default(""),
  candidateId: uuid.nullable().optional(),
  revisionId: uuid.nullable().optional(),
});

export const generateArtifactsSchema = z.object({
  revisionId: uuid,
  types: z.array(trimmed(60)).min(1, "Select at least one artifact."),
  /** What to do with artifacts whose latest version was edited by hand. */
  onEdited: z.enum(["keep", "replace"]).optional(),
  idempotencyKey: trimmed(100).min(8),
});

export const artifactEditSchema = z.object({ content: z.string().max(400_000), expectedVersion: z.number().int().min(1) });

export const generateSkillsSchema = z.object({ revisionId: uuid, onEdited: z.enum(["keep", "replace"]).optional(), idempotencyKey: trimmed(100).min(8) });
export const skillEditSchema = z.object({ skillMd: z.string().min(1).max(100_000), expectedVersion: z.number().int().min(1) });

export const planCreateSchema = z.object({ environmentId: uuid, manifestId: uuid });
export const approvalCreateSchema = z.object({
  planHash: z.string().regex(/^[0-9a-f]{64}$/, "Plan hash must be the 64-character hash shown on the plan."),
  note: trimmed(1000).min(3, "Say what you are approving and why."),
  expiresInHours: z.number().int().min(1).max(72).default(8),
  confirmEnvironment: trimmed(80).min(1, "Type the environment name to confirm."),
});
export const runCreateSchema = z.object({ mode: z.enum(["dry-run", "execute"]).default("dry-run"), approvalId: uuid.optional() });

export const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) });
export const settingsSchema = z.object({
  workspaceName: trimmed(80).min(2).optional(),
  freshnessPolicyDays: z.number().int().min(7).max(3650).optional(),
  defaultWeights: weightsSchema.optional(),
});
export const askSchema = z.object({ question: trimmed(600).min(3, "Ask a question of at least 3 characters.") });
