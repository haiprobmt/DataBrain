export interface ArtifactDef {
  type: string;
  name: string;
  category: "Architecture" | "Documents" | "Implementation" | "Migration & QA";
  path: string;
  format: "markdown" | "json" | "mermaid" | "drawio" | "terraform" | "yaml" | "sql";
  description: string;
}

export const TEMPLATE_VERSION = "2026.11-1";

export const ARTIFACT_DEFS: ArtifactDef[] = [
  { type: "diagram-mermaid", name: "Architecture diagram (Mermaid)", category: "Architecture", path: "diagrams/architecture.mmd", format: "mermaid", description: "Text diagram that renders in Markdown viewers." },
  { type: "diagram-drawio", name: "Architecture diagram (draw.io)", category: "Architecture", path: "diagrams/architecture.drawio", format: "drawio", description: "Editable diagram for diagrams.net / draw.io." },
  { type: "diagram-reactflow", name: "Architecture diagram model (JSON)", category: "Architecture", path: "diagrams/architecture.reactflow.json", format: "json", description: "The editable React Flow model with provenance per component." },
  { type: "blueprint-json", name: "Blueprint data (JSON)", category: "Architecture", path: "blueprint.json", format: "json", description: "Requirements, sections, decisions and sources as structured data." },
  { type: "executive-summary", name: "Executive summary", category: "Documents", path: "docs/executive-summary.md", format: "markdown", description: "One-page summary of the recommendation." },
  { type: "hld", name: "High-level design (HLD)", category: "Documents", path: "docs/hld.md", format: "markdown", description: "Context, logical architecture, data flows and decisions." },
  { type: "lld", name: "Low-level design (LLD)", category: "Documents", path: "docs/lld.md", format: "markdown", description: "Component inventory and configuration, with placeholders to complete." },
  { type: "adr", name: "Architecture decision records", category: "Documents", path: "docs/adr.md", format: "markdown", description: "All decision records for the project." },
  { type: "security-design", name: "Security design", category: "Documents", path: "docs/security-design.md", format: "markdown", description: "Identity, network and compliance design." },
  { type: "runbook", name: "Operations runbook", category: "Documents", path: "docs/runbook.md", format: "markdown", description: "Monitoring, DR and routine operations outline." },
  { type: "iac", name: "Terraform starter", category: "Implementation", path: "iac/main.tf", format: "terraform", description: "Variables and a component inventory. Declares no resources." },
  { type: "pipeline", name: "CI validation pipeline", category: "Implementation", path: "pipelines/validate.yml", format: "yaml", description: "GitHub Actions workflow that formats and validates the IaC. It never applies." },
  { type: "sql-scaffold", name: "SQL scaffold", category: "Implementation", path: "sql/schemas.sql", format: "sql", description: "Schema scaffold for the storage layers in the diagram." },
  { type: "migration-plan", name: "Migration plan", category: "Migration & QA", path: "migration/migration-plan.md", format: "markdown", description: "Phases, source-to-target mapping template and reconciliation approach." },
  { type: "test-plan", name: "Test plan", category: "Migration & QA", path: "qa/test-plan.md", format: "markdown", description: "Acceptance test cases derived from the requirements." },
  { type: "cutover-rollback", name: "Cutover and rollback checklist", category: "Migration & QA", path: "migration/cutover-rollback-checklist.md", format: "markdown", description: "Checklist to complete before, during and after cutover." },
];

export const ARTIFACT_CATEGORIES = ["Architecture", "Documents", "Implementation", "Migration & QA"] as const;
export const artifactDef = (type: string) => ARTIFACT_DEFS.find((d) => d.type === type);
