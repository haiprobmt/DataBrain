import { artifactDef } from "@/lib/artifact-catalog";
import { countPlaceholders, findSecrets, redact, validateContent } from "@/lib/content-checks";
import type { PlanStage } from "@/lib/types";
import { sha256 } from "../crypto";
import type { AdapterContext, DeploymentAdapter, StageExecution } from "./types";

type Check = StageExecution["checks"][number];

/**
 * Local simulator. It runs real, read-only checks on the generated files (checksums, syntax, secret scan)
 * and reports everything that needs a real platform as skipped — never as passed. It cannot change anything.
 */
export class LocalSimulatorAdapter implements DeploymentAdapter {
  readonly name = "local-simulator";
  readonly simulated = true;
  readonly capabilities = {
    platforms: ["any (no platform is contacted)"],
    supportedOperations: ["static-validation", "secret-scan", "package-integrity", "runbook-readiness"],
    requiredScopes: [],
    prerequisites: ["A generation manifest for an approved architecture revision."],
    rollbackLimitations: ["Nothing is deployed, so there is nothing to roll back."],
  };

  async runStage(stage: PlanStage, context: AdapterContext): Promise<StageExecution> {
    const checks: Check[] = [];
    const log: string[] = [];
    const skipped = (name: string, detail: string, command: string): Check => ({ name, status: "skipped", detail, tool: this.name, command, exitCode: null, output: detail, artifactRefs: [] });

    switch (stage.level) {
      case "static":
        for (const file of context.files) {
          const actual = sha256(file.content);
          const intact = actual === file.checksum;
          checks.push({ name: `Integrity: ${file.path}`, status: intact ? "passed" : "failed", detail: intact ? "Content matches the manifest checksum." : "Content differs from the checksum recorded in the manifest.", tool: "sha256", command: `sha256 ${file.path}`, exitCode: intact ? 0 : 1, output: `expected ${file.checksum}\nactual   ${actual}`, artifactRefs: [file.path] });
          const syntax = validateContent(artifactDef(file.type)?.format ?? "markdown", file.content).checks.find((c) => c.name === "Syntax")!;
          checks.push({ name: `Syntax: ${file.path}`, status: syntax.status, detail: syntax.detail, tool: "databrain-content-checks", command: `check-syntax ${file.path}`, exitCode: syntax.status === "failed" ? 1 : 0, output: syntax.detail, artifactRefs: [file.path] });
        }
        log.push(`Checked ${context.files.length} file(s).`);
        break;
      case "security": {
        const hits = context.files.map((f) => ({ path: f.path, found: findSecrets(f.content) })).filter((h) => h.found.length);
        checks.push({ name: "Secret scan", status: hits.length ? "failed" : "passed", detail: hits.length ? `Credential-like strings in: ${hits.map((h) => h.path).join(", ")}` : `No credential-like strings in ${context.files.length} file(s).`, tool: "databrain-secret-scan", command: "scan-secrets <package>", exitCode: hits.length ? 1 : 0, output: redact(hits.map((h) => `${h.path}: ${h.found.join(", ")}`).join("\n")) || "clean", artifactRefs: hits.map((h) => h.path) });
        const todo = context.files.map((f) => ({ path: f.path, n: countPlaceholders(f.content) })).filter((t) => t.n > 0);
        const total = todo.reduce((sum, t) => sum + t.n, 0);
        checks.push({ name: "Unresolved placeholders", status: total ? "warning" : "passed", detail: total ? `${total} TODO/PLACEHOLDER marker(s) remain in ${todo.length} file(s). The package is not ready to deploy.` : "No placeholders remain.", tool: "databrain-content-checks", command: "count-placeholders <package>", exitCode: 0, output: todo.map((t) => `${t.path}: ${t.n}`).join("\n") || "none", artifactRefs: todo.map((t) => t.path) });
        checks.push(skipped("Least privilege and public exposure", "Needs a real platform adapter with read access to the target environment.", "not run"));
        break;
      }
      case "preflight":
        for (const name of ["Authentication", "Permissions", "Quotas and region availability", "Naming and network prerequisites"]) {
          checks.push(skipped(name, "Not checked: the simulator has no credentials and contacts no platform.", "not run"));
        }
        break;
      case "deployment":
        for (const op of stage.operations) {
          checks.push(
            skipped(
              op.description,
              context.mode === "dry-run" ? "Dry-run: planned, not executed." : "Simulated: no real deployment adapter is configured, so nothing was created or changed.",
              context.mode === "dry-run" ? `plan ${op.changeType} ${op.id}` : `simulate ${op.changeType} ${op.id}`,
            ),
          );
        }
        log.push(`${stage.operations.length} operation(s) planned; none executed.`);
        break;
      case "functional":
        checks.push(skipped("Connectivity and sample pipeline run", "Nothing is deployed by the simulator, so there is nothing to test.", "not run"));
        break;
      case "operational": {
        const has = (type: string) => context.files.some((f) => f.type === type);
        checks.push({ name: "Runbook in package", status: has("runbook") ? "passed" : "warning", detail: has("runbook") ? "docs/runbook.md is part of the package." : "The package has no operations runbook.", tool: "databrain-package-checks", command: "check-package runbook", exitCode: 0, output: has("runbook") ? "present" : "missing", artifactRefs: has("runbook") ? ["docs/runbook.md"] : [] });
        checks.push({ name: "Rollback checklist in package", status: has("cutover-rollback") ? "passed" : "warning", detail: has("cutover-rollback") ? "The cutover and rollback checklist is part of the package." : "The package has no cutover and rollback checklist.", tool: "databrain-package-checks", command: "check-package cutover-rollback", exitCode: 0, output: has("cutover-rollback") ? "present" : "missing", artifactRefs: has("cutover-rollback") ? ["migration/cutover-rollback-checklist.md"] : [] });
        checks.push(skipped("Monitoring, alerting and backup", "Needs a real platform adapter.", "not run"));
        break;
      }
    }
    const failed = checks.some((c) => c.status === "failed");
    const allSkipped = checks.length > 0 && checks.every((c) => c.status === "skipped");
    return { stageId: stage.id, status: failed ? "failed" : allSkipped ? "skipped" : "succeeded", checks, log };
  }
}
