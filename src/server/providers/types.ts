import type { DeploymentPlanBody, PlanStage, CheckResult } from "@/lib/types";

export interface ExtractedField {
  field: string;
  value: string;
  /** Normalised matching tokens, e.g. "fabric", "streaming", "gdpr". */
  tokens: string[];
  /** The sentence of the user's text the fact was read from. */
  evidence: string;
  confidence: number;
}

export interface ExtractionResult {
  provider: string;
  model: string;
  facts: ExtractedField[];
  /** Fields nothing was stated about, each with the question to ask. */
  missing: { field: string; question: string }[];
  assumptions: string[];
}

/** Text-generation boundary. The local implementation is rule-based and never invents values. */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly isGenerative: boolean;
  extractRequirements(text: string): Promise<ExtractionResult>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface Reranker {
  readonly name: string;
  rerank<T extends { score: number }>(query: string, items: T[]): Promise<T[]>;
}

export interface DocumentExtractor {
  readonly name: string;
  supports(fileName: string): boolean;
  extract(fileName: string, bytes: Uint8Array): Promise<{ text: string; title: string }>;
}

export interface ObjectStorage {
  readonly name: string;
  put(key: string, bytes: Uint8Array): Promise<{ key: string; checksum: string; size: number }>;
  get(key: string): Promise<Uint8Array | null>;
}

/** Connector that pulls documents from an external system. None ship yet; imports are manual uploads. */
export interface SourceConnector {
  readonly name: string;
  list(): Promise<{ id: string; title: string; url: string }[]>;
  fetch(id: string): Promise<{ title: string; text: string; url: string }>;
}

export interface StageExecution {
  stageId: string;
  status: "succeeded" | "failed" | "skipped";
  checks: (CheckResult & { tool: string; command: string; exitCode: number | null; output: string; artifactRefs: string[] })[];
  log: string[];
}

export interface AdapterContext {
  mode: "dry-run" | "execute";
  plan: DeploymentPlanBody;
  /** Artifact contents by path, exactly as recorded in the generation manifest. */
  files: { path: string; content: string; checksum: string; type: string }[];
}

export interface DeploymentAdapter {
  readonly name: string;
  /** True when the adapter never touches a real platform. Its results must be labelled as simulated. */
  readonly simulated: boolean;
  readonly capabilities: {
    platforms: string[];
    supportedOperations: string[];
    requiredScopes: string[];
    prerequisites: string[];
    rollbackLimitations: string[];
  };
  runStage(stage: PlanStage, context: AdapterContext): Promise<StageExecution>;
}
