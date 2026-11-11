import { env } from "../env";
import { AppError } from "../errors";
import { AnthropicProvider } from "./anthropic";
import { LocalRulesProvider } from "./local-llm";
import { LocalFsStorage, LocalHashEmbeddingProvider, PassthroughReranker, PlainTextExtractor } from "./local";
import { LocalSimulatorAdapter } from "./simulator";
import type { DeploymentAdapter, DocumentExtractor, EmbeddingProvider, LLMProvider, ObjectStorage, Reranker } from "./types";

/**
 * Provider registry. An unknown provider name is a configuration error:
 * the app never silently swaps a configured real provider for a local stand-in.
 */
function unavailable(kind: string, name: string): never {
  throw new AppError("provider_unavailable", `${kind} provider "${name}" is not implemented. Set it to "local" or add an adapter in src/server/providers.`);
}

export function getLLM(): LLMProvider {
  if (env.llmProvider === "local") return new LocalRulesProvider();
  if (env.llmProvider === "anthropic") {
    if (!env.hasAnthropicCredential) {
      throw new AppError("provider_unavailable", "LLM_PROVIDER is \"anthropic\" but ANTHROPIC_API_KEY is not set on the server. Add the key, or set LLM_PROVIDER=local.");
    }
    return new AnthropicProvider(env.anthropicModel);
  }
  return unavailable("LLM", env.llmProvider);
}

export function getEmbeddings(): EmbeddingProvider {
  if (env.embeddingProvider === "local") return new LocalHashEmbeddingProvider();
  return unavailable("Embedding", env.embeddingProvider);
}

export function getReranker(): Reranker {
  return new PassthroughReranker();
}

export function getExtractors(): DocumentExtractor[] {
  return [new PlainTextExtractor()];
}

export function getStorage(): ObjectStorage {
  if (env.storageProvider === "local") return new LocalFsStorage(env.storageLocalDir);
  return unavailable("Storage", env.storageProvider);
}

export function getDeploymentAdapter(): DeploymentAdapter {
  if (env.deploymentAdapter === "local-simulator") return new LocalSimulatorAdapter();
  return unavailable("Deployment", env.deploymentAdapter);
}

export function providerStatus() {
  const describe = (kind: string, configured: string, resolve: () => { name: string }, note: string) => {
    try {
      return { kind, configured, active: resolve().name, available: true, note };
    } catch (error) {
      return { kind, configured, active: null, available: false, note: error instanceof Error ? error.message : String(error) };
    }
  };
  return [
    describe(
      "LLM",
      env.llmProvider,
      () => {
        const llm = getLLM();
        return { name: llm.isGenerative ? `${llm.name} (${llm.model})` : llm.name };
      },
      env.llmProvider === "anthropic"
        ? "Claude extracts requirements, drafts blueprint sections and answers questions from retrieved passages. Project briefs and passages are sent to the Anthropic API. Output is labelled generated."
        : "Rule-based extraction from your own text. No generative model is configured.",
    ),
    describe("Embeddings", env.embeddingProvider, getEmbeddings, "Deterministic feature hashing: lexical similarity only."),
    describe("Reranker", "none", getReranker, "No reranking model; results keep their hybrid score order."),
    describe("Object storage", env.storageProvider, getStorage, `Local filesystem at ${env.storageLocalDir}.`),
    describe("Deployment adapter", env.deploymentAdapter, getDeploymentAdapter, "Simulator: runs real static checks on generated files and never touches a cloud platform."),
  ];
}
