import { CANDIDATE_LABELS, FACTOR_LABELS } from "./catalog";
import { FACTOR_KEYS, type CandidateFactor, type FactorKey, type FinderWeights, type KnowledgeAttributes } from "./types";
import { PLATFORM_CLOUDS, tokenLabel } from "./vocab";

export interface RequirementFact {
  state: "known" | "unknown" | "not-applicable";
  value: string;
  tokens: string[];
}
export type RequirementProfile = Record<string, RequirementFact | undefined>;

export interface ScenarioProfile {
  id: string;
  title: string;
  status: string;
  attributes: KnowledgeAttributes;
}

export interface ScoreResult {
  excluded: string | null;
  score: number;
  confidence: number;
  label: keyof typeof CANDIDATE_LABELS;
  factors: CandidateFactor[];
  gaps: string[];
  assumptions: string[];
  matchReasons: string[];
}

const CLOUD_TOKENS = ["azure", "aws", "gcp"];
const labels = (tokens: string[]) => tokens.map(tokenLabel).join(", ");
const round = (n: number) => Math.round(n * 1000) / 1000;

function known(profile: RequirementProfile, field: string): RequirementFact | null {
  const fact = profile[field];
  return fact && fact.state === "known" ? fact : null;
}
const isNA = (profile: RequirementProfile, field: string) => profile[field]?.state === "not-applicable";

function coverage(required: string[], offered: string[]): { ratio: number; hit: string[]; miss: string[] } {
  const hit = required.filter((t) => offered.includes(t));
  const miss = required.filter((t) => !offered.includes(t));
  return { ratio: required.length ? hit.length / required.length : 1, hit, miss };
}

type Partial = Omit<CandidateFactor, "key" | "label" | "weight">;
const neutral = (reason: string): Partial => ({ score: 0.5, known: false, evidence: [], gaps: [reason] });

function workloadFactor(req: RequirementProfile, a: KnowledgeAttributes): Partial {
  const workloads = known(req, "workloads");
  const latency = known(req, "latency");
  if (!workloads?.tokens.length && !latency?.tokens.length) return neutral("Workloads and latency are not stated, so workload fit cannot be judged.");
  const evidence: string[] = [];
  const gaps: string[] = [];
  const parts: { ratio: number; weight: number }[] = [];
  if (workloads?.tokens.length) {
    const c = coverage(workloads.tokens, a.workloads ?? []);
    parts.push({ ratio: c.ratio, weight: 0.7 });
    if (c.hit.length) evidence.push(`Covers workloads: ${labels(c.hit)}`);
    if (c.miss.length) gaps.push(`Scenario does not cover: ${labels(c.miss)}`);
  } else gaps.push("Workloads are not stated.");
  if (latency?.tokens.length) {
    const c = coverage(latency.tokens, a.latency ?? []);
    parts.push({ ratio: c.ratio, weight: 0.3 });
    if (c.hit.length) evidence.push(`Supports latency: ${labels(c.hit)}`);
    if (c.miss.length) gaps.push(`Latency not covered: ${labels(c.miss)}`);
  } else gaps.push("Latency requirement is not stated.");
  const total = parts.reduce((s, p) => s + p.weight, 0);
  return { score: parts.reduce((s, p) => s + p.ratio * p.weight, 0) / total, known: true, evidence, gaps };
}

function platformFactor(req: RequirementProfile, a: KnowledgeAttributes): Partial & { excluded: string | null } {
  const target = known(req, "target_platform");
  const sources = known(req, "source_systems");
  const evidence: string[] = [];
  const gaps: string[] = [];
  let excluded: string | null = null;
  let platformScore: number | null = null;

  if (target?.tokens.length) {
    const reqClouds = target.tokens.filter((t) => CLOUD_TOKENS.includes(t));
    const reqPlatforms = target.tokens.filter((t) => !CLOUD_TOKENS.includes(t) && t !== "on-premises");
    const scenarioClouds = a.clouds ?? [];
    // A stated platform implies the clouds it can run on.
    const allowedClouds = reqClouds.length ? reqClouds : [...new Set(reqPlatforms.flatMap((p) => PLATFORM_CLOUDS[p] ?? []))];
    if (allowedClouds.length && scenarioClouds.length && !scenarioClouds.some((c) => allowedClouds.includes(c))) {
      excluded = `Runs on ${labels(scenarioClouds)}, but the target is ${labels(allowedClouds)}.`;
    }
    if (reqPlatforms.length) {
      const c = coverage(reqPlatforms, a.platforms ?? []);
      if (c.hit.length) {
        platformScore = c.ratio;
        evidence.push(`Built on the target platform: ${labels(c.hit)}`);
        if (c.miss.length) gaps.push(`Does not use: ${labels(c.miss)}`);
      } else {
        platformScore = 0.35;
        gaps.push(`Uses ${labels(a.platforms ?? [])} instead of the stated ${labels(reqPlatforms)} — an alternative, not a match.`);
      }
    } else if (reqClouds.length) {
      platformScore = 0.8;
      evidence.push(`Available on ${labels(reqClouds.filter((c) => scenarioClouds.includes(c)))}; no specific platform is stated.`);
    }
  }

  let sourceScore: number | null = null;
  if (sources?.tokens.length) {
    const c = coverage(sources.tokens, a.sourceSystems ?? []);
    sourceScore = c.ratio;
    if (c.hit.length) evidence.push(`Scenario describes ingestion from: ${labels(c.hit)}`);
    if (c.miss.length) gaps.push(`No ingestion guidance for: ${labels(c.miss)}`);
  }

  if (platformScore === null && sourceScore === null) {
    return { ...neutral("Target platform and source systems are not stated."), excluded };
  }
  if (platformScore === null) gaps.push("Target platform is not stated.");
  if (sourceScore === null) gaps.push("Source systems are not stated.");
  const score = platformScore !== null && sourceScore !== null ? 0.7 * platformScore + 0.3 * sourceScore : (platformScore ?? sourceScore ?? 0.5);
  return { score, known: platformScore !== null, evidence, gaps, excluded };
}

function securityFactor(req: RequirementProfile, a: KnowledgeAttributes): Partial {
  const fields = ["compliance", "identity", "network", "availability"];
  const stated = fields.map((f) => known(req, f)).filter((f): f is RequirementFact => !!f && f.tokens.length > 0);
  if (stated.length === 0) {
    if (fields.every((f) => isNA(req, f))) return { score: 1, known: true, evidence: ["Security, network and availability requirements are marked not applicable."], gaps: [] };
    return neutral("Compliance, identity, network and availability requirements are not stated.");
  }
  const required = [...new Set(stated.flatMap((f) => f.tokens))];
  const c = coverage(required, a.security ?? []);
  const gaps = c.miss.length ? [`Not addressed by the scenario: ${labels(c.miss)}`] : [];
  const unstated = fields.filter((f) => !known(req, f) && !isNA(req, f));
  if (unstated.length) gaps.push(`Still unknown: ${unstated.join(", ")}`);
  return { score: c.ratio, known: true, evidence: c.hit.length ? [`Addresses: ${labels(c.hit)}`] : [], gaps };
}

function scaleFactor(value: number | undefined, what: string, low: string, high: string): Partial {
  if (!value) return neutral(`The scenario does not record its ${what}.`);
  return {
    score: (6 - value) / 5,
    known: true,
    evidence: [`Scenario ${what} is rated ${value} of 5 (${value <= 2 ? low : value >= 4 ? high : "moderate"}) by its author.`],
    gaps: [],
  };
}

function costFactor(req: RequirementProfile, a: KnowledgeAttributes): Partial {
  const budget = known(req, "budget");
  const drivers = (a.costDrivers ?? []).slice(0, 4).map((d) => `Cost driver: ${d}`);
  if (!budget?.tokens.length) return { ...neutral("Cost sensitivity is not stated."), evidence: drivers };
  if (!a.costModel) return { ...neutral("The scenario does not record its billing model."), evidence: drivers };
  if (budget.tokens.includes("cost-sensitive")) {
    const score = a.costModel === "consumption" ? 0.9 : a.costModel === "mixed" ? 0.6 : 0.4;
    return { score, known: true, evidence: [`Project is cost-sensitive; scenario billing is mostly ${a.costModel}.`, ...drivers], gaps: a.costModel === "provisioned" ? ["Provisioned capacity is paid for whether or not it is used."] : [] };
  }
  return { score: 0.8, known: true, evidence: ["Budget is stated as available; cost drivers are listed for review.", ...drivers], gaps: [] };
}

function teamFactor(req: RequirementProfile, a: KnowledgeAttributes): Partial {
  const skills = known(req, "team_skills");
  const needed = a.skills ?? [];
  if (!skills?.tokens.length) return neutral("Team skills are not stated.");
  if (needed.length === 0) return neutral("The scenario does not list the skills it needs.");
  const c = coverage(needed, skills.tokens);
  return {
    score: c.ratio,
    known: true,
    evidence: c.hit.length ? [`Team already has: ${labels(c.hit)}`] : [],
    gaps: c.miss.length ? [`Skills to build or hire: ${labels(c.miss)}`] : [],
  };
}

const TRUST_MULTIPLIER: Record<string, number> = { verified: 1, reviewed: 0.9, draft: 0.75 };

export function normaliseWeights(weights: FinderWeights): FinderWeights {
  const total = FACTOR_KEYS.reduce((sum, key) => sum + Math.max(0, weights[key] ?? 0), 0) || 1;
  return Object.fromEntries(FACTOR_KEYS.map((key) => [key, Math.max(0, weights[key] ?? 0) / total])) as FinderWeights;
}

/**
 * Score one scenario against the approved requirements.
 * Unknown inputs score a neutral 0.5 and lower the confidence — missing evidence is never a positive match.
 */
export function scoreScenario(req: RequirementProfile, scenario: ScenarioProfile, weights: FinderWeights): ScoreResult {
  const a = scenario.attributes;
  const w = normaliseWeights(weights);
  const platform = platformFactor(req, a);
  const parts: Record<FactorKey, Partial> = {
    workload: workloadFactor(req, a),
    platform,
    security: securityFactor(req, a),
    complexity: scaleFactor(a.complexity, "operational complexity", "low operational burden", "demanding to operate"),
    migration: scaleFactor(a.migrationEffort, "migration effort", "light migration", "heavy migration"),
    cost: costFactor(req, a),
    team: teamFactor(req, a),
  };
  const factors: CandidateFactor[] = FACTOR_KEYS.map((key) => ({ key, label: FACTOR_LABELS[key].label, weight: round(w[key]), ...parts[key], score: round(parts[key].score) }));
  const score = round(factors.reduce((sum, f) => sum + f.score * w[f.key], 0));
  const knownShare = factors.reduce((sum, f) => sum + (f.known ? w[f.key] : 0), 0);
  const confidence = round(knownShare * (TRUST_MULTIPLIER[scenario.status] ?? 0.75));

  const core = factors.filter((f) => ["workload", "platform", "security"].includes(f.key));
  const exact = core.every((f) => f.known && f.gaps.length === 0 && f.score >= 0.999);
  const label: ScoreResult["label"] = knownShare < 0.5 ? "assumption" : exact ? "exact-reference" : "adapted-reference";

  const assumptions = factors.filter((f) => !f.known).map((f) => `${f.label} is scored a neutral 50% because its inputs are unknown.`);
  if (scenario.status === "draft") assumptions.push("The reference scenario is a draft that has not been reviewed; confidence is reduced.");
  return {
    excluded: platform.excluded,
    score,
    confidence,
    label,
    factors,
    gaps: [...new Set(factors.flatMap((f) => f.gaps))],
    assumptions,
    matchReasons: factors.flatMap((f) => f.evidence).filter((line) => !line.startsWith("Cost driver:")).slice(0, 8),
  };
}
