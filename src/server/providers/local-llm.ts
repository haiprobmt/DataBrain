import { INTAKE_FIELDS } from "@/lib/intake";
import { FIELD_VOCAB, matchGroup, type VocabEntry } from "@/lib/vocab";
import type { ExtractedField, ExtractionResult, LLMProvider } from "./types";

export function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const REGEX_FIELDS: { field: string; pattern: RegExp; confidence: number }[] = [
  { field: "data_volume", pattern: /\b\d+(?:[.,]\d+)?\s?(?:tb|gb|pb|terabytes?|gigabytes?|petabytes?|million rows|billion rows)\b/i, confidence: 0.85 },
  { field: "users", pattern: /\b\d[\d,.]*\s?k?\+?\s+(?:concurrent |business |report |active |internal |external )?(?:users|analysts|consumers|employees|seats)\b/i, confidence: 0.8 },
  { field: "timeline", pattern: /\b(?:(?:in|within|over|next)\s+\d+\s+(?:weeks?|months?|years?)|\d+[- ](?:week|month|year)s?\b|q[1-4]\s?(?:20\d\d)?|by (?:january|february|march|april|may|june|july|august|september|october|november|december)\b(?:\s+20\d\d)?)/i, confidence: 0.7 },
  { field: "availability", pattern: /\b(?:rpo|rto)\b[^.;\n]*|\b99\.\d+\s?%/i, confidence: 0.8 },
  { field: "business_objective", pattern: /\b(?:want|wants|need|needs|goal|objective|aim|aims|so that|in order to|looking to|plan(?:s|ning)? to)\b/i, confidence: 0.5 },
  { field: "constraints", pattern: /\b(?:must not|cannot|can't|constraint|constrained|restricted to|only allowed|existing (?:contract|licen[cs]e|agreement)|enterprise agreement)\b/i, confidence: 0.55 },
];

/**
 * Deterministic requirement extraction: vocabulary and pattern matching over the user's own text.
 * It records the sentence each fact came from and lists every field it found nothing for.
 * It never fills a gap with a guess.
 */
export class LocalRulesProvider implements LLMProvider {
  readonly name = "local-rules";
  readonly model = "vocabulary-v1";
  readonly isGenerative = false;

  async extractRequirements(text: string): Promise<ExtractionResult> {
    const sentences = splitSentences(text);
    const facts: ExtractedField[] = [];

    for (const [field, groups] of Object.entries(FIELD_VOCAB)) {
      const hits: VocabEntry[] = [];
      const evidence: string[] = [];
      for (const sentence of sentences) {
        const found = groups.flatMap((g) => matchGroup(g, sentence));
        const fresh = found.filter((f) => !hits.some((h) => h.token === f.token));
        if (fresh.length > 0) {
          hits.push(...fresh);
          evidence.push(sentence);
        }
      }
      if (hits.length > 0) {
        facts.push({
          field,
          value: hits.map((h) => h.label).join(", "),
          tokens: hits.map((h) => h.token),
          evidence: evidence.slice(0, 3).join(" … "),
          confidence: 0.8,
        });
      }
    }

    for (const rule of REGEX_FIELDS) {
      const sentence = sentences.find((s) => rule.pattern.test(s));
      if (!sentence) continue;
      const existing = facts.find((f) => f.field === rule.field);
      const match = sentence.match(rule.pattern)?.[0] ?? sentence;
      const quotesWholeSentence = rule.field === "business_objective" || rule.field === "constraints";
      const value = quotesWholeSentence ? sentence : match.trim();
      if (existing) {
        if (!existing.value.includes(value)) existing.value = `${existing.value} (${value})`;
      } else {
        facts.push({ field: rule.field, value, tokens: [], evidence: sentence, confidence: rule.confidence });
      }
    }

    const found = new Set(facts.map((f) => f.field));
    const missing = INTAKE_FIELDS.filter((f) => !found.has(f.key)).map((f) => ({ field: f.key, question: f.question }));

    const assumptions: string[] = [];
    const platform = facts.find((f) => f.field === "target_platform");
    if (platform && platform.tokens.every((t) => ["azure", "aws", "gcp", "on-premises"].includes(t))) {
      assumptions.push(`A cloud (${platform.value}) is stated but no specific data platform; every platform available on it is considered.`);
    }
    for (const fact of facts.filter((f) => f.confidence < 0.6)) {
      const label = INTAKE_FIELDS.find((f) => f.key === fact.field)?.label ?? fact.field;
      assumptions.push(`${label} was read from a loosely worded sentence — confirm it: “${fact.evidence}”`);
    }

    return { provider: this.name, model: this.model, facts, missing, assumptions };
  }
}
