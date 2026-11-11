// Shared domain types used by the database schema, services and UI.

export type TrustOrigin = "reference" | "adapted" | "generated" | "assumption" | "user";

export interface KnowledgeSection {
  key: string;
  title: string;
  body: string;
}

export type NodeKind =
  | "source"
  | "ingestion"
  | "storage"
  | "processing"
  | "serving"
  | "consumer"
  | "security"
  | "governance"
  | "network"
  | "operations"
  | "other";

export interface Provenance {
  origin: TrustOrigin;
  /** Knowledge item the element was taken from, when there is one. */
  itemId?: string;
  note?: string;
}

export interface DiagramNode {
  id: string;
  kind: NodeKind;
  label: string;
  description: string;
  technology?: string;
  config: Record<string, string>;
  provenance: Provenance;
  /** Intake field keys this component exists to satisfy. */
  requirementFields: string[];
  position: { x: number; y: number };
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: "data" | "control" | "network";
  description?: string;
  provenance: Provenance;
}

export interface DiagramModel {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface KnowledgeAttributes {
  platforms?: string[];
  clouds?: string[];
  workloads?: string[];
  latency?: string[];
  sourceSystems?: string[];
  security?: string[];
  skills?: string[];
  /** 1 (simple) – 5 (demanding). Relative judgement, not a measurement. */
  complexity?: number;
  migrationEffort?: number;
  costDrivers?: string[];
  /** How the platform is mostly billed. Used for cost-sensitivity fit; no prices are stored. */
  costModel?: "consumption" | "provisioned" | "mixed";
  tradeoffs?: string[];
  limitations?: string[];
  diagram?: DiagramModel;
  vendor?: string;
  category?: string;
  /** Free-form facts used by Technology Compare; keys are row labels. */
  compare?: Record<string, string>;
  strategy?: string;
  steps?: string[];
  projectId?: string;
}

export interface IntakeField {
  state: "known" | "unknown" | "not-applicable";
}

export const FACTOR_KEYS = [
  "workload",
  "platform",
  "security",
  "complexity",
  "migration",
  "cost",
  "team",
] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];
export type FinderWeights = Record<FactorKey, number>;

export interface CandidateFactor {
  key: FactorKey;
  label: string;
  /** 0–1. A decision aid, not a fact. */
  score: number;
  weight: number;
  /** False when the requirement behind this factor is unknown: the score is neutral and confidence drops. */
  known: boolean;
  evidence: string[];
  gaps: string[];
}

export interface BlueprintSection {
  key: string;
  title: string;
  body: string;
  origin: TrustOrigin;
  edited: boolean;
}

export interface CheckResult {
  name: string;
  status: "passed" | "warning" | "failed" | "skipped";
  detail: string;
}

export interface ArtifactValidation {
  status: "passed" | "warning" | "failed";
  checks: CheckResult[];
  placeholders: number;
}

export interface ManifestFile {
  path: string;
  type: string;
  category: string;
  format: string;
  artifactId: string;
  artifactRevisionId: string;
  version: number;
  origin: "generated" | "user-edit";
  templateVersion: string;
  checksum: string;
  validationStatus: ArtifactValidation["status"];
  sourceItemIds: string[];
}

export interface GenerationManifestBody {
  schemaVersion: 1;
  projectId: string;
  projectName: string;
  architectureRevisionId: string;
  architectureRevisionVersion: number;
  architectureContentHash: string;
  generatedAt: string;
  generator: string;
  files: ManifestFile[];
  sources: { id: string; title: string; url: string | null; sourceType: string; status: string }[];
  assumptions: string[];
}

export interface SkillFile {
  path: string;
  content: string;
}

export interface SkillCompatibility {
  platforms: string[];
  services: string[];
  versionConstraints: string;
  regionConstraints: string;
  lastVerifiedAt: string | null;
  notes: string;
}

export interface SkillValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PlanOperation {
  id: string;
  description: string;
  artifactPath?: string;
  changeType: "none" | "create" | "update" | "delete";
  destructive: boolean;
}

export interface PlanStage {
  id: string;
  name: string;
  level: "static" | "preflight" | "deployment" | "functional" | "security" | "operational";
  description: string;
  /** Stages that change the target only run in execute mode with a valid approval. */
  changesTarget: boolean;
  operations: PlanOperation[];
}

export interface DeploymentPlanBody {
  schemaVersion: 1;
  environment: { id: string; name: string; kind: string; platform: string };
  manifestId: string;
  manifestHash: string;
  architectureRevisionId: string;
  adapter: { name: string; simulated: boolean; supportedOperations: string[]; requiredScopes: string[]; rollbackLimitations: string[] };
  stages: PlanStage[];
  impact: { summary: string; componentsAffected: string[]; costNote: string };
  rollback: string[];
  prerequisites: string[];
}

export interface ApprovalScope {
  mode: "execute";
  environmentKind: string;
  stageIds: string[];
}

export interface RunLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  stage?: string;
  message: string;
}
