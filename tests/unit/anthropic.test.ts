import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/errors";
import { AnthropicProvider } from "@/server/providers/anthropic";

/** A stand-in for the SDK client. No network call is made in these tests. */
function fakeClient(handlers: { parse?: (params: Record<string, unknown>) => unknown; create?: (params: Record<string, unknown>) => unknown }) {
  const parse = vi.fn(async (params: Record<string, unknown>) => handlers.parse?.(params));
  const create = vi.fn(async (params: Record<string, unknown>) => handlers.create?.(params));
  return { client: { beta: { messages: { parse, create } } } as unknown as Anthropic, parse, create };
}

const BRIEF = "Sources are SQL Server and Salesforce. The target platform is Microsoft Fabric on Azure. About 400 users.";
const parsed = (facts: unknown[], assumptions: string[] = []) => ({ stop_reason: "end_turn", model: "claude-opus-5-5", parsed_output: { facts, assumptions } });

describe("AnthropicProvider.extractRequirements", () => {
  it("keeps facts whose evidence is quoted from the brief and derives matching tokens", async () => {
    const { client, parse } = fakeClient({
      parse: () =>
        parsed([
          { field: "target_platform", value: "Microsoft Fabric on Azure", evidence: "The target platform is Microsoft Fabric on Azure.", confidence: 0.95 },
          { field: "source_systems", value: "SQL Server, Salesforce", evidence: "Sources are SQL Server   and Salesforce.", confidence: 0.9 },
        ]),
    });
    const result = await new AnthropicProvider("claude-opus-5-5", client).extractRequirements(BRIEF);
    expect(result.provider).toBe("anthropic");
    expect(result.facts.map((f) => f.field)).toEqual(["target_platform", "source_systems"]);
    expect(result.facts[0]?.tokens.sort()).toEqual(["azure", "fabric"]);
    expect(result.facts[1]?.tokens.sort()).toEqual(["salesforce", "sql-server"]);
    expect(result.missing.map((m) => m.field)).toContain("compliance");
    expect(result.missing.map((m) => m.field)).not.toContain("target_platform");

    const request = parse.mock.calls[0]![0];
    expect(request.model).toBe("claude-opus-5-5");
    expect(request.fallbacks).toBe("default");
    expect(request.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(request).not.toHaveProperty("thinking");
    expect(request).not.toHaveProperty("temperature");
    expect(JSON.stringify(request.messages)).toContain("<project_brief>");
  });

  it("discards facts the model invented: evidence not in the brief, empty values, duplicates", async () => {
    const { client } = fakeClient({
      parse: () =>
        parsed([
          { field: "data_volume", value: "50 TB", evidence: "The warehouse holds 50 TB of data.", confidence: 0.9 },
          { field: "compliance", value: "HIPAA", evidence: "HIPAA", confidence: 0.9 },
          { field: "users", value: "", evidence: "About 400 users.", confidence: 0.9 },
          { field: "users", value: "400 users", evidence: "About 400 users.", confidence: 4 },
          { field: "users", value: "four hundred", evidence: "About 400 users.", confidence: 0.9 },
        ]),
    });
    const result = await new AnthropicProvider("claude-opus-5-5", client).extractRequirements(BRIEF);
    expect(result.facts.map((f) => `${f.field}=${f.value}`)).toEqual(["users=400 users"]);
    expect(result.facts[0]?.confidence).toBe(1);
    expect(result.missing.map((m) => m.field)).toEqual(expect.arrayContaining(["data_volume", "compliance"]));
    expect(result.assumptions.join(" ")).toMatch(/4 item\(s\) from the model were discarded/);
  });

  it("reports refusals, truncation, unparseable replies and API errors instead of returning anything", async () => {
    const run = (handler: () => unknown) => new AnthropicProvider("claude-opus-5-5", fakeClient({ parse: handler }).client).extractRequirements(BRIEF);
    await expect(run(() => ({ stop_reason: "refusal", model: "m", parsed_output: null }))).rejects.toMatchObject({ code: "precondition_failed" });
    await expect(run(() => ({ stop_reason: "max_tokens", model: "m", parsed_output: null }))).rejects.toMatchObject({ code: "provider_unavailable" });
    await expect(run(() => ({ stop_reason: "end_turn", model: "m", parsed_output: null }))).rejects.toMatchObject({ code: "provider_unavailable" });
    const apiError = (status: number) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message: "sk-ant-secret-should-not-leak" } }, "boom", new Headers());
    const auth = await run(() => { throw apiError(401); }).catch((e: unknown) => e);
    expect(auth).toBeInstanceOf(AppError);
    expect((auth as AppError).message).toMatch(/rejected the API key/);
    expect((auth as AppError).message).not.toMatch(/sk-ant/);
    await expect(run(() => { throw apiError(429); })).rejects.toMatchObject({ code: "rate_limited" });
    await expect(run(() => { throw apiError(500); })).rejects.toMatchObject({ code: "provider_unavailable" });
  });
});

describe("AnthropicProvider text generation", () => {
  const text = (value: string, extra: Record<string, unknown> = {}) => ({ stop_reason: "end_turn", model: "claude-opus-5-5", content: [{ type: "thinking", thinking: "" }, { type: "text", text: value }], ...extra });

  it("answers only from numbered passages and reports the model that served the reply", async () => {
    const { client, create } = fakeClient({ create: () => text("Bronze keeps raw data [1].", { model: "claude-opus-4-8" }) });
    const result = await new AnthropicProvider("claude-opus-5-5", client).answer("How does medallion work?", [{ n: 1, title: 'The "medallion" pattern', status: "draft", text: "Bronze keeps data as received." }]);
    expect(result).toEqual({ text: "Bronze keeps raw data [1].", model: "claude-opus-4-8" });
    const request = create.mock.calls[0]![0];
    expect(String(request.system)).toMatch(/using only the numbered passages/);
    expect(JSON.stringify(request.messages)).toContain('<passage n=\\"1\\" title=\\"The \'medallion\' pattern\\" status=\\"draft\\">');
  });

  it("drafts a section with the project's facts and the no-invention rules", async () => {
    const { client, create } = fakeClient({ create: () => text("### Approach\n\nTODO: confirm RPO.") });
    const result = await new AnthropicProvider("claude-opus-5-5", client).draftSection({ projectName: "Retail", sectionTitle: "Rollback", currentBody: "", architectureTitle: "Fabric lakehouse", requirements: ["Availability / DR: unknown"], components: ["Gold lakehouse [serving]"], flows: ["Silver → Gold"], referenceNotes: [] });
    expect(result.text).toContain("TODO: confirm RPO.");
    const request = create.mock.calls[0]![0];
    expect(String(request.system)).toMatch(/PLACEHOLDER/);
    expect(String(request.system)).toMatch(/Never invent facts/);
    expect(JSON.stringify(request.messages)).toContain("Availability / DR: unknown");
  });

  it("fails on a refusal or an empty reply", async () => {
    const run = (response: unknown) => new AnthropicProvider("claude-opus-5-5", fakeClient({ create: () => response }).client).answer("q?", [{ n: 1, title: "t", status: "draft", text: "x" }]);
    await expect(run({ stop_reason: "refusal", model: "m", content: [] })).rejects.toMatchObject({ code: "precondition_failed" });
    await expect(run({ stop_reason: "end_turn", model: "m", content: [{ type: "thinking", thinking: "" }] })).rejects.toMatchObject({ code: "provider_unavailable" });
  });
});
