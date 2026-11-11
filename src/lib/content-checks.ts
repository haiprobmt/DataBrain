import type { ArtifactValidation, CheckResult } from "./types";

/** Patterns that look like credentials. Generated packages must never contain a match. */
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9\-_.=]{20,}/ },
  { name: "connection string password", pattern: /\b(?:password|pwd|secret|api[_-]?key|access[_-]?key|token)\s*[:=]\s*["']?(?!PLACEHOLDER|TODO|<|\$\{|var\.|\*{3})[A-Za-z0-9+/_\-!@#$%^&*]{8,}/i },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "Azure storage key", pattern: /AccountKey=[A-Za-z0-9+/=]{20,}/ },
];

export function findSecrets(content: string): string[] {
  return SECRET_PATTERNS.filter((s) => s.pattern.test(content)).map((s) => s.name);
}

/** Replace anything secret-like before text is stored as evidence or logged. */
export function redact(content: string): string {
  let out = content;
  for (const { pattern } of SECRET_PATTERNS) out = out.replace(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"), "[REDACTED]");
  return out;
}

export function countPlaceholders(content: string): number {
  return (content.match(/\bTODO\b|PLACEHOLDER/g) ?? []).length;
}

function balanced(content: string): boolean {
  let depth = 0;
  for (const ch of content.replace(/"(?:[^"\\]|\\.)*"/g, "").replace(/#.*$/gm, "")) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function syntaxCheck(format: string, content: string): CheckResult {
  const name = "Syntax";
  if (!content.trim()) return { name, status: "failed", detail: "The file is empty." };
  switch (format) {
    case "json":
      try {
        JSON.parse(content);
        return { name, status: "passed", detail: "Parses as JSON." };
      } catch (error) {
        return { name, status: "failed", detail: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
      }
    case "terraform":
      return balanced(content)
        ? { name, status: "passed", detail: "Braces are balanced. `terraform validate` was not run — Terraform is not installed in DataBrain." }
        : { name, status: "failed", detail: "Unbalanced braces." };
    case "yaml":
      return /\t/.test(content) ? { name, status: "failed", detail: "YAML must not contain tab characters." } : { name, status: "passed", detail: "No tab indentation. A YAML parser was not run." };
    case "mermaid":
      return /^flowchart\s/m.test(content) ? { name, status: "passed", detail: "Starts with a flowchart declaration." } : { name, status: "failed", detail: "Missing flowchart declaration." };
    case "drawio":
      return content.includes("<mxfile") && content.trim().endsWith("</mxfile>") ? { name, status: "passed", detail: "Has an mxfile root element." } : { name, status: "failed", detail: "Not a draw.io document." };
    case "sql":
      return (content.match(/\(/g)?.length ?? 0) === (content.match(/\)/g)?.length ?? 0) ? { name, status: "passed", detail: "Parentheses are balanced. The SQL was not executed." } : { name, status: "failed", detail: "Unbalanced parentheses." };
    default:
      return { name, status: "passed", detail: "Non-empty document." };
  }
}

export function validateContent(format: string, content: string): ArtifactValidation {
  const secrets = findSecrets(content);
  const placeholders = countPlaceholders(content);
  const checks: CheckResult[] = [
    syntaxCheck(format, content),
    secrets.length ? { name: "No secrets", status: "failed", detail: `Looks like it contains: ${secrets.join(", ")}.` } : { name: "No secrets", status: "passed", detail: "No credential-like strings found." },
    placeholders ? { name: "Placeholders", status: "warning", detail: `${placeholders} TODO/PLACEHOLDER marker(s) to complete before use.` } : { name: "Placeholders", status: "passed", detail: "No TODO or PLACEHOLDER markers." },
  ];
  const status = checks.some((c) => c.status === "failed") ? "failed" : checks.some((c) => c.status === "warning") ? "warning" : "passed";
  return { status, checks, placeholders };
}
