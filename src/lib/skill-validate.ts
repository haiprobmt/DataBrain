import { findSecrets } from "./content-checks";
import type { SkillValidation } from "./types";

export const REQUIRED_SKILL_SECTIONS = ["When to use", "Prerequisites", "Inputs", "Workflow", "Safety boundaries", "Outputs", "Validation", "Failure handling", "Source references"];

export function parseFrontmatter(md: string): { fields: Record<string, string>; body: string } | null {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m && m[1]) fields[m[1]] = (m[2] ?? "").trim().replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"');
  }
  return { fields, body: match[2] ?? "" };
}

/** Validate a SKILL.md against the packaging rules so it loads in Claude and other agents. */
export function validateSkillMd(md: string, folderName: string): SkillValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = parseFrontmatter(md);
  if (!parsed) return { valid: false, errors: ["SKILL.md must start with a YAML frontmatter block delimited by --- lines."], warnings };

  const { name, description } = parsed.fields;
  if (!name) errors.push("Frontmatter is missing `name`.");
  else {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) errors.push("`name` must be lowercase letters, digits and single hyphens.");
    if (name.length > 64) errors.push("`name` must be 64 characters or fewer.");
    if (name !== folderName) errors.push(`\`name\` (“${name}”) must match the skill folder name (“${folderName}”).`);
  }
  if (!description) errors.push("Frontmatter is missing `description`.");
  else {
    if (description.length > 1024) errors.push(`\`description\` is ${description.length} characters; the limit is 1024.`);
    if (!/\buse\b/i.test(description)) warnings.push("`description` should say when to use the skill, not only what it does.");
  }
  for (const heading of REQUIRED_SKILL_SECTIONS) {
    if (!new RegExp(`^##\\s+${heading}\\s*$`, "mi").test(parsed.body)) errors.push(`Missing section: “## ${heading}”.`);
  }
  const secrets = findSecrets(md);
  if (secrets.length) errors.push(`Looks like it contains a credential: ${secrets.join(", ")}.`);
  if (/\bTODO\b|PLACEHOLDER/.test(parsed.body)) warnings.push("Contains TODO or PLACEHOLDER markers to complete.");
  return { valid: errors.length === 0, errors, warnings };
}

/** Dependency-first ordering. Returns null when the graph has a cycle. */
export function topologicalOrder(names: string[], deps: { from: string; to: string }[]): string[] | null {
  const remaining = new Set(names);
  const order: string[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter((n) => deps.filter((d) => d.from === n).every((d) => !remaining.has(d.to))).sort();
    if (ready.length === 0) return null;
    for (const n of ready) {
      order.push(n);
      remaining.delete(n);
    }
  }
  return order;
}
