/** Server-side configuration. Never import this from a client component. */
export const env = {
  get databaseUrl() {
    return process.env.DATABASE_URL ?? "postgres://databrain:databrain@localhost:5432/databrain";
  },
  get sessionSecret() {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret === "change-me-to-a-long-random-value") {
      if (process.env.NODE_ENV === "production" && !this.demoMode) {
        throw new Error("SESSION_SECRET must be set to a long random value when demo mode is off.");
      }
      return secret ?? "databrain-local-development-secret";
    }
    return secret;
  },
  get demoMode() {
    return (process.env.DATABRAIN_DEMO_MODE ?? "true") !== "false";
  },
  get llmProvider() {
    return process.env.LLM_PROVIDER ?? "local";
  },
  get anthropicModel() {
    return process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
  },
  /** True when the server has an Anthropic credential. The value itself is never read here or shown anywhere. */
  get hasAnthropicCredential() {
    return !!(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
  },
  get embeddingProvider() {
    return process.env.EMBEDDING_PROVIDER ?? "local";
  },
  get storageProvider() {
    return process.env.STORAGE_PROVIDER ?? "local";
  },
  get storageLocalDir() {
    return process.env.STORAGE_LOCAL_DIR ?? ".data/storage";
  },
  get deploymentAdapter() {
    return process.env.DEPLOYMENT_ADAPTER ?? "local-simulator";
  },
  get freshnessPolicyDays() {
    const n = Number(process.env.FRESHNESS_POLICY_DAYS ?? "180");
    return Number.isFinite(n) && n > 0 ? n : 180;
  },
};
