import { z } from "zod";
import { ARTICLE_SECTIONS, RELATIONSHIP_TYPES } from "@/lib/catalog";
import type { KnowledgeAttributes, KnowledgeSection } from "@/lib/types";
import { SEED_ITEMS, SEED_RELATIONSHIPS, SEED_SOURCES, type SeedItem } from "./content";
import awsGcp from "./research/aws-gcp.json";
import azureAiNetwork from "./research/azure-ai-network.json";
import databricks from "./research/databricks.json";
import fabric from "./research/fabric.json";
import migrationDelivery from "./research/migration-delivery.json";
import snowflake from "./research/snowflake.json";

/**
 * The starter knowledge library = the hand-written base items in content.ts, overlaid with research files.
 *
 * Each research file was produced by an AI research pass that used web search against official documentation
 * and recorded the pages each item relies on. It read search-result summaries and snippets, not whole pages,
 * and no person has reviewed it. Items therefore load as drafts with origin "ai-researched".
 */
const sectionKeys = ARTICLE_SECTIONS.map((s) => s.key) as [string, ...string[]];
const sourceSchema = z.object({
  title: z.string().trim().min(3).max(200),
  url: z.string().trim().url().startsWith("https://").max(600),
  publisher: z.string().trim().max(120).default(""),
  sourceType: z.enum(["vendor-official", "standards-framework", "community"]).default("vendor-official"),
  supports: z.string().trim().max(400).default(""),
});
const sectionsSchema = z.partialRecord(z.enum(sectionKeys), z.string().trim().max(6000));
const attributesSchema = z
  .object({
    costDrivers: z.array(z.string().trim().max(300)).max(12),
    tradeoffs: z.array(z.string().trim().max(300)).max(12),
    limitations: z.array(z.string().trim().max(300)).max(12),
    steps: z.array(z.string().trim().max(500)).max(20),
    compare: z.record(z.string().trim().max(80), z.string().trim().max(600)),
  })
  .partial();
const overlaySchema = z.object({
  cluster: z.string(),
  researchedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(
    z.object({
      slug: z.string(),
      summary: z.string().trim().min(20).max(1200).optional(),
      sections: sectionsSchema.optional(),
      attributes: attributesSchema.optional(),
      tokenNotes: z.string().optional(),
      sources: z.array(sourceSchema).max(8).default([]),
      corrections: z.array(z.string()).default([]),
      unconfirmed: z.array(z.string()).default([]),
    }),
  ),
  newItems: z
    .array(
      z.object({
        slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
        type: z.enum(["technology", "architecture-pattern", "best-practice", "concept", "technique"]),
        title: z.string().trim().min(3).max(160),
        summary: z.string().trim().min(20).max(1200),
        tags: z.array(z.string().trim().max(40)).max(10).default([]),
        sections: sectionsSchema.default({}),
        attributes: attributesSchema.default({}),
        relationships: z.array(z.tuple([z.enum(RELATIONSHIP_TYPES), z.string()])).max(10).default([]),
        sources: z.array(sourceSchema).max(8).default([]),
      }),
    )
    .max(3)
    .default([]),
});

export interface LibrarySource {
  key: string;
  title: string;
  url: string;
  publisher: string;
  sourceType: "vendor-official" | "standards-framework" | "community";
  /** ISO date the page was found by the research pass; null for the unverified base sources. */
  checkedOn: string | null;
}
export interface LibraryItem extends Omit<SeedItem, "sources"> {
  /** ISO date of the AI research pass, or null when the item is still the unchecked base text. */
  researchedOn: string | null;
  sources: { key: string; note: string }[];
}

const toSections = (record: Partial<Record<string, string>> | undefined): KnowledgeSection[] =>
  ARTICLE_SECTIONS.filter((s) => record?.[s.key]?.trim()).map((s) => ({ key: s.key, title: s.title, body: record![s.key]!.trim() }));

function build() {
  const overlays = [fabric, databricks, snowflake, awsGcp, azureAiNetwork, migrationDelivery].map((raw) => overlaySchema.parse(raw));
  const sources = new Map<string, LibrarySource>();
  for (const s of SEED_SOURCES) sources.set(s.key, { ...s, checkedOn: null });
  const sourceKey = (source: z.infer<typeof sourceSchema>, checkedOn: string): string => {
    const key = `url:${source.url.replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase()}`;
    if (!sources.has(key)) sources.set(key, { key, title: source.title, url: source.url, publisher: source.publisher, sourceType: source.sourceType, checkedOn });
    return key;
  };

  const items = new Map<string, LibraryItem>(
    SEED_ITEMS.map((item) => [item.slug, { ...item, researchedOn: null, sources: item.sources.map((key) => ({ key, note: "Documentation home page. The text was not checked against it." })) }]),
  );
  const relationships: [string, string, string][] = [...SEED_RELATIONSHIPS];

  for (const overlay of overlays) {
    for (const patch of overlay.items) {
      const base = items.get(patch.slug);
      if (!base) throw new Error(`Research file "${overlay.cluster}" refers to unknown item "${patch.slug}".`);
      const researched = patch.sources.length > 0;
      const sections = toSections(patch.sections);
      items.set(patch.slug, {
        ...base,
        summary: patch.summary ?? base.summary,
        sections: sections.length ? sections : base.sections,
        // Matching tokens and the diagram stay as authored; research replaces only the descriptive lists.
        attributes: { ...base.attributes, ...(patch.attributes as KnowledgeAttributes | undefined) },
        researchedOn: researched ? overlay.researchedOn : null,
        sources: researched ? patch.sources.map((s) => ({ key: sourceKey(s, overlay.researchedOn), note: s.supports })) : base.sources,
      });
    }
    for (const added of overlay.newItems) {
      if (items.has(added.slug)) throw new Error(`Research file "${overlay.cluster}" adds "${added.slug}", which already exists.`);
      if (added.sources.length === 0) continue; // An unsourced new item is not worth shipping.
      items.set(added.slug, {
        slug: added.slug,
        type: added.type,
        title: added.title,
        summary: added.summary,
        tags: added.tags,
        sourceType: added.sources[0]!.sourceType,
        sections: toSections(added.sections),
        attributes: added.attributes as KnowledgeAttributes,
        researchedOn: overlay.researchedOn,
        sources: added.sources.map((s) => ({ key: sourceKey(s, overlay.researchedOn), note: s.supports })),
      });
      for (const [type, to] of added.relationships) relationships.push([added.slug, type, to]);
    }
  }

  const known = new Set(items.keys());
  const seen = new Set<string>();
  const validRelationships = relationships.filter(([from, type, to]) => {
    const key = `${from}|${type}|${to}`;
    if (!known.has(from) || !known.has(to) || from === to || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const used = new Set([...items.values()].flatMap((i) => i.sources.map((s) => s.key)));
  return { items: [...items.values()], sources: [...sources.values()].filter((s) => used.has(s.key)), relationships: validRelationships };
}

export const LIBRARY = build();
