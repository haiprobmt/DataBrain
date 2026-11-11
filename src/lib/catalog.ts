import type { FactorKey, FinderWeights, NodeKind } from "./types";

export const KNOWLEDGE_TYPES = [
  { key: "domain", label: "Domain" },
  { key: "technology", label: "Technology" },
  { key: "capability", label: "Capability" },
  { key: "concept", label: "Concept" },
  { key: "technique", label: "Technique" },
  { key: "architecture-pattern", label: "Architecture pattern" },
  { key: "scenario", label: "Scenario" },
  { key: "playbook", label: "Playbook" },
  { key: "best-practice", label: "Best practice" },
  { key: "migration-strategy", label: "Migration strategy" },
  { key: "project-experience", label: "Project experience" },
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number]["key"];
export const KNOWLEDGE_TYPE_KEYS = KNOWLEDGE_TYPES.map((t) => t.key) as [KnowledgeType, ...KnowledgeType[]];
export const knowledgeTypeLabel = (key: string) => KNOWLEDGE_TYPES.find((t) => t.key === key)?.label ?? key;

export const RELATIONSHIP_TYPES = [
  "related_to",
  "depends_on",
  "implements",
  "alternative_to",
  "part_of",
  "integrates_with",
  "uses",
  "targets",
  "supersedes",
  "validated_by",
  "derived_from",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const SOURCE_TYPES = [
  { key: "vendor-official", label: "Vendor official" },
  { key: "standards-framework", label: "Standards / framework" },
  { key: "community", label: "Community" },
  { key: "internal-experience", label: "Internal experience" },
  { key: "unspecified", label: "Unspecified" },
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number]["key"];
export const SOURCE_TYPE_KEYS = SOURCE_TYPES.map((t) => t.key) as [SourceType, ...SourceType[]];
export const sourceTypeLabel = (key: string) => SOURCE_TYPES.find((t) => t.key === key)?.label ?? key;

/** Article structure from the knowledge-intelligence skill. */
export const ARTICLE_SECTIONS = [
  { key: "context", title: "Problem / context" },
  { key: "concepts", title: "Core concepts" },
  { key: "how-it-works", title: "How it works" },
  { key: "implementation", title: "Implementation steps" },
  { key: "prerequisites", title: "Prerequisites" },
  { key: "best-practices", title: "Best practices" },
  { key: "limitations", title: "Limitations / trade-offs" },
  { key: "security", title: "Security" },
  { key: "cost-drivers", title: "Cost drivers" },
  { key: "validation", title: "Validation" },
] as const;

export const TRUST_LABELS = {
  verified: { label: "Verified reference", tone: "ok", help: "Reviewed against identified authoritative sources or validated project evidence." },
  reviewed: { label: "Reviewed reference", tone: "info", help: "Human-reviewed but not necessarily deployed." },
  draft: { label: "Draft", tone: "neutral", help: "Not reviewed. Verify before relying on it." },
  archived: { label: "Archived", tone: "neutral", help: "Kept for history; excluded from search and matching." },
} as const;

export const CANDIDATE_LABELS = {
  "exact-reference": { label: "Exact reference", tone: "ok", help: "An existing scenario matches the stated requirements without changes." },
  "adapted-reference": { label: "Adapted reference", tone: "info", help: "Based on an existing scenario with explicit changes or gaps to close." },
  "generated-proposal": { label: "Generated proposal", tone: "warn", help: "Composed by the local rules engine. Not validated." },
  assumption: { label: "Assumption requiring validation", tone: "warn", help: "Rests on unknown or unconfirmed input." },
} as const;

export const ORIGIN_LABELS = {
  reference: { label: "From reference", tone: "ok" },
  adapted: { label: "Adapted", tone: "info" },
  generated: { label: "Generated — not validated", tone: "warn" },
  assumption: { label: "Assumption", tone: "warn" },
  user: { label: "Authored", tone: "neutral" },
} as const;

export const FACTOR_LABELS: Record<FactorKey, { label: string; help: string }> = {
  workload: { label: "Workload fit", help: "Do the scenario's workloads and latency profile cover what the project needs?" },
  platform: { label: "Platform compatibility", help: "Does the scenario run on the target platform and connect to the source systems?" },
  security: { label: "Security / network fit", help: "Are the compliance, identity and connectivity requirements covered?" },
  complexity: { label: "Operational complexity", help: "Lower operational burden scores higher." },
  migration: { label: "Migration effort", help: "Lower migration effort scores higher, judged against the timeline." },
  cost: { label: "Cost drivers", help: "How well the scenario's cost drivers suit the stated cost sensitivity. No prices are estimated." },
  team: { label: "Team capability", help: "Overlap between the skills the scenario needs and the skills the team has." },
};

export const DEFAULT_WEIGHTS: FinderWeights = {
  workload: 25,
  platform: 20,
  security: 15,
  complexity: 10,
  migration: 10,
  cost: 10,
  team: 10,
};

export const NODE_KINDS: { key: NodeKind; label: string; color: string }[] = [
  { key: "source", label: "Source", color: "#7a8ba6" },
  { key: "ingestion", label: "Ingestion", color: "#3074cc" },
  { key: "storage", label: "Storage", color: "#102650" },
  { key: "processing", label: "Processing", color: "#f28a00" },
  { key: "serving", label: "Serving", color: "#15845d" },
  { key: "consumer", label: "Consumer", color: "#5b6f95" },
  { key: "security", label: "Security", color: "#df4b44" },
  { key: "governance", label: "Governance", color: "#8a5a00" },
  { key: "network", label: "Network", color: "#2a7f9e" },
  { key: "operations", label: "Operations", color: "#6a52a3" },
  { key: "other", label: "Other", color: "#7a8ba6" },
];
export const nodeKindColor = (kind: string) => NODE_KINDS.find((k) => k.key === kind)?.color ?? "#7a8ba6";

/** Graph node colours per knowledge type, drawn from the brand palette. */
export const TYPE_COLORS: Record<string, string> = {
  domain: "#102650",
  technology: "#3074cc",
  capability: "#2a7f9e",
  concept: "#7a8ba6",
  technique: "#5b6f95",
  "architecture-pattern": "#f28a00",
  scenario: "#15845d",
  playbook: "#8a5a00",
  "best-practice": "#f5b600",
  "migration-strategy": "#df4b44",
  "project-experience": "#6a52a3",
};
