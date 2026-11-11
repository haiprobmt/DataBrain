import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS } from "@/lib/catalog";
import { findSecrets, redact, validateContent } from "@/lib/content-checks";
import { toDrawio, toMermaid, validateDiagram } from "@/lib/diagram";
import { isStale } from "@/lib/freshness";
import { diagramSchema, knowledgeInputSchema } from "@/lib/schemas";
import { normaliseWeights, scoreScenario, type RequirementProfile, type ScenarioProfile } from "@/lib/scoring";
import { topologicalOrder, validateSkillMd } from "@/lib/skill-validate";
import type { DiagramModel } from "@/lib/types";
import { canonicalJson, slugify } from "@/lib/utils";
import { tokensForField } from "@/lib/vocab";
import { hashJson, hashPassword, verifyPassword } from "@/server/crypto";
import { LocalHashEmbeddingProvider, cosine } from "@/server/providers/local";
import { LocalRulesProvider } from "@/server/providers/local-llm";

const known = (value: string, tokens: string[]) => ({ state: "known" as const, value, tokens });
const fabric: ScenarioProfile = {
  id: "s1",
  title: "Fabric lakehouse",
  status: "verified",
  attributes: { platforms: ["fabric"], clouds: ["azure"], workloads: ["bi", "data-warehouse"], latency: ["batch"], sourceSystems: ["sql-server"], security: ["sso", "rls", "gdpr"], skills: ["sql", "power-bi"], complexity: 2, migrationEffort: 3, costModel: "provisioned", costDrivers: ["Capacity size"] },
};

describe("scoring", () => {
  const full: RequirementProfile = {
    workloads: known("BI", ["bi"]),
    latency: known("Batch", ["batch"]),
    target_platform: known("Fabric on Azure", ["fabric", "azure"]),
    source_systems: known("SQL Server", ["sql-server"]),
    compliance: known("GDPR", ["gdpr"]),
    identity: known("SSO", ["sso"]),
    network: { state: "not-applicable", value: "", tokens: [] },
    availability: { state: "not-applicable", value: "", tokens: [] },
    budget: known("flexible", ["cost-flexible"]),
    team_skills: known("SQL, Power BI", ["sql", "power-bi"]),
  };

  it("labels a full match as an exact reference with high confidence", () => {
    const result = scoreScenario(full, fabric, DEFAULT_WEIGHTS);
    expect(result.excluded).toBeNull();
    expect(result.label).toBe("exact-reference");
    expect(result.confidence).toBe(1);
    expect(result.score).toBeGreaterThan(0.8);
    expect(result.factors).toHaveLength(7);
  });

  it("never treats missing requirements as a match: neutral score and lower confidence", () => {
    const result = scoreScenario({}, fabric, DEFAULT_WEIGHTS);
    for (const key of ["workload", "platform", "security", "cost", "team"]) {
      const factor = result.factors.find((f) => f.key === key)!;
      expect(factor.known).toBe(false);
      expect(factor.score).toBe(0.5);
      expect(factor.gaps.length).toBeGreaterThan(0);
    }
    expect(result.confidence).toBeLessThan(0.3);
    expect(result.label).toBe("assumption");
    expect(result.assumptions.length).toBeGreaterThan(0);
  });

  it("excludes scenarios on a different cloud and explains why", () => {
    const result = scoreScenario({ target_platform: known("AWS", ["aws"]) }, fabric, DEFAULT_WEIGHTS);
    expect(result.excluded).toMatch(/Azure/);
  });

  it("keeps a same-cloud alternative platform but marks it adapted with a gap", () => {
    const result = scoreScenario({ ...full, target_platform: known("Databricks on Azure", ["databricks", "azure"]) }, fabric, DEFAULT_WEIGHTS);
    expect(result.excluded).toBeNull();
    expect(result.label).toBe("adapted-reference");
    expect(result.gaps.join(" ")).toMatch(/instead of the stated/);
  });

  it("reports uncovered requirements as gaps", () => {
    const result = scoreScenario({ ...full, workloads: known("BI and GenAI", ["bi", "genai"]), compliance: known("GDPR, HIPAA", ["gdpr", "hipaa"]) }, fabric, DEFAULT_WEIGHTS);
    expect(result.gaps.join(" ")).toMatch(/Generative AI/);
    expect(result.gaps.join(" ")).toMatch(/HIPAA/);
    expect(result.label).toBe("adapted-reference");
  });

  it("lowers confidence for an unreviewed draft scenario", () => {
    const draft = scoreScenario(full, { ...fabric, status: "draft" }, DEFAULT_WEIGHTS);
    expect(draft.confidence).toBeCloseTo(0.75);
    expect(draft.assumptions.join(" ")).toMatch(/draft/);
  });

  it("changes the ranking score when weights change", () => {
    const base = scoreScenario(full, fabric, DEFAULT_WEIGHTS).score;
    const complexityOnly = scoreScenario(full, fabric, { workload: 0, platform: 0, security: 0, complexity: 100, migration: 0, cost: 0, team: 0 }).score;
    expect(complexityOnly).toBeCloseTo(0.8);
    expect(complexityOnly).not.toBe(base);
    const w = normaliseWeights(DEFAULT_WEIGHTS);
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe("local requirement extraction", () => {
  const llm = new LocalRulesProvider();
  it("extracts stated facts with the sentence as evidence", async () => {
    const result = await llm.extractRequirements("We want a single reporting platform. Sources are SQL Server and Salesforce. The target is Microsoft Fabric on Azure. About 3 TB of data, loaded daily. 400 users. Data must stay in the EU for GDPR.");
    const get = (field: string) => result.facts.find((f) => f.field === field);
    expect(get("target_platform")?.tokens).toEqual(expect.arrayContaining(["fabric", "azure"]));
    expect(get("source_systems")?.tokens).toEqual(expect.arrayContaining(["sql-server", "salesforce"]));
    expect(get("data_volume")?.value).toMatch(/3 TB/);
    expect(get("users")?.value).toMatch(/400 users/);
    expect(get("compliance")?.tokens).toEqual(expect.arrayContaining(["gdpr", "data-residency"]));
    expect(get("source_systems")?.evidence).toContain("SQL Server");
  });

  it("lists everything it did not find instead of inventing it", async () => {
    const result = await llm.extractRequirements("We need better reporting.");
    expect(result.facts.find((f) => f.field === "data_volume")).toBeUndefined();
    expect(result.facts.find((f) => f.field === "compliance")).toBeUndefined();
    const missing = result.missing.map((m) => m.field);
    expect(missing).toEqual(expect.arrayContaining(["data_volume", "compliance", "target_platform", "users", "network"]));
    expect(result.missing.every((m) => m.question.endsWith("?"))).toBe(true);
  });

  it("does not read 'near real-time' as real-time", () => {
    expect(tokensForField("latency", "near real-time refresh")).toEqual(["near-real-time"]);
    expect(tokensForField("latency", "real-time streaming")).toEqual(["real-time"]);
  });
});

describe("diagram", () => {
  const prov = { origin: "reference" as const };
  const node = (id: string, kind: DiagramModel["nodes"][number]["kind"] = "storage") => ({ id, kind, label: id, description: "", config: {}, provenance: prov, requirementFields: [], position: { x: 0, y: 0 } });
  const model: DiagramModel = { nodes: [node("a", "source"), node("b")], edges: [{ id: "a__b", source: "a", target: "b", label: "load", kind: "data", provenance: prov }] };

  it("accepts a valid model and exports it", () => {
    expect(validateDiagram(model).filter((i) => i.severity === "error")).toEqual([]);
    expect(toMermaid(model)).toContain("a -->|\"load\"| b");
    expect(toDrawio(model, "T")).toContain("<mxfile");
    expect(diagramSchema.safeParse(model).success).toBe(true);
  });

  it("rejects dangling connections and empty diagrams", () => {
    expect(validateDiagram({ nodes: [], edges: [] }).some((i) => i.severity === "error")).toBe(true);
    const dangling = { ...model, edges: [{ ...model.edges[0]!, target: "missing" }] };
    expect(validateDiagram(dangling).some((i) => i.severity === "error")).toBe(true);
    expect(diagramSchema.safeParse(dangling).success).toBe(false);
  });

  it("warns about orphans and unvalidated components", () => {
    const issues = validateDiagram({ nodes: [...model.nodes, { ...node("c"), provenance: { origin: "generated" } }], edges: model.edges });
    expect(issues.filter((i) => i.severity === "warning").length).toBe(2);
  });
});

describe("content checks", () => {
  it("finds and redacts credential-like strings", () => {
    const text = 'password = "hunter2hunter2"\nAKIAABCDEFGHIJKLMNOP';
    expect(findSecrets(text)).toEqual(expect.arrayContaining(["AWS access key", "connection string password"]));
    expect(redact(text)).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(findSecrets("password = PLACEHOLDER\ntoken: ${{ secrets.X }}\nlocation = var.location")).toEqual([]);
  });

  it("grades files: failed on bad syntax or secrets, warning on placeholders", () => {
    expect(validateContent("json", "{oops").status).toBe("failed");
    expect(validateContent("terraform", "locals {\n  a = 1\n").status).toBe("failed");
    expect(validateContent("markdown", "# Doc\n\nTODO: finish").status).toBe("warning");
    expect(validateContent("json", '{"a":1}').status).toBe("passed");
  });
});

describe("skill validation", () => {
  const body = ["When to use", "Prerequisites", "Inputs", "Workflow", "Safety boundaries", "Outputs", "Validation", "Failure handling", "Source references"].map((h) => `## ${h}\n\n- x`).join("\n\n");
  const md = (name: string, description: string) => `---\nname: ${name}\ndescription: "${description}"\n---\n\n# T\n\n${body}\n`;

  it("accepts a well-formed SKILL.md", () => {
    expect(validateSkillMd(md("platform-fabric", "Does things. Use when needed."), "platform-fabric")).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("rejects bad names, long descriptions, missing sections and folder mismatch", () => {
    expect(validateSkillMd(md("Platform_Fabric", "Use it."), "Platform_Fabric").errors.join(" ")).toMatch(/lowercase/);
    expect(validateSkillMd(md("a", "x".repeat(1100)), "a").errors.join(" ")).toMatch(/1024/);
    expect(validateSkillMd(md("a", "Use it."), "b").errors.join(" ")).toMatch(/folder name/);
    expect(validateSkillMd("---\nname: a\ndescription: Use it.\n---\n# T\n", "a").errors.length).toBe(9);
    expect(validateSkillMd("# no frontmatter", "a").valid).toBe(false);
  });

  it("orders dependencies first and detects cycles", () => {
    expect(topologicalOrder(["validate", "scenario", "platform"], [{ from: "validate", to: "scenario" }, { from: "scenario", to: "platform" }])).toEqual(["platform", "scenario", "validate"]);
    expect(topologicalOrder(["a", "b"], [{ from: "a", to: "b" }, { from: "b", to: "a" }])).toBeNull();
  });
});

describe("utilities", () => {
  it("hashes equal data equally regardless of key order", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
    expect(hashJson({ a: 1, b: 2 })).toBe(hashJson({ b: 2, a: 1 }));
    expect(hashJson({ a: 1 })).not.toBe(hashJson({ a: 2 }));
  });

  it("slugifies, verifies passwords and flags stale knowledge", () => {
    expect(slugify("Azure Databricks: Lakehouse (v2)")).toBe("azure-databricks-lakehouse-v2");
    const hash = hashPassword("correct horse battery");
    expect(verifyPassword("correct horse battery", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
    const now = new Date("2026-11-11T00:00:00Z");
    expect(isStale({ status: "verified", lastVerifiedAt: new Date("2026-01-01T00:00:00Z") }, 180, now)).toBe(true);
    expect(isStale({ status: "verified", lastVerifiedAt: new Date("2026-10-01T00:00:00Z") }, 180, now)).toBe(false);
    expect(isStale({ status: "draft", lastVerifiedAt: null }, 180, now)).toBe(false);
  });

  it("embeds deterministically, ranking related text closer", async () => {
    const provider = new LocalHashEmbeddingProvider();
    const [a, b, c, a2] = await provider.embed(["fabric lakehouse power bi reporting", "power bi reporting on a fabric lakehouse", "kafka streaming events", "fabric lakehouse power bi reporting"]);
    expect(a).toEqual(a2);
    expect(cosine(a!, b!)).toBeGreaterThan(cosine(a!, c!));
  });

  it("validates knowledge input", () => {
    expect(knowledgeInputSchema.safeParse({ title: "ab", type: "concept", summary: "" }).success).toBe(false);
    expect(knowledgeInputSchema.safeParse({ title: "Valid title", type: "concept", summary: "Summary." }).success).toBe(true);
  });
});
