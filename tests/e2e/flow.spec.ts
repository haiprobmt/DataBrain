import { expect, test, type Page } from "@playwright/test";

const BRIEF =
  "A retail company wants a single trusted reporting platform for finance and sales. Source systems are an on-premises SQL Server ERP database and Salesforce. The target platform is Microsoft Fabric on Azure. Around 3 TB of history, loaded as a daily batch. About 400 report users use Power BI dashboards. Data must stay in the EU for GDPR. Users sign in with Microsoft Entra ID and need row-level security. The team is strong in SQL and Power BI. The project is cost-sensitive.";

const consoleErrors: string[] = [];

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `horizontal overflow on ${page.url()}`).toBeLessThanOrEqual(1);
}

test.describe.configure({ mode: "serial" });

test.describe("project → finder → approve → generate → skills → dry-run", () => {
  let page: Page;
  let projectUrl: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on("console", (message) => {
      // The browser logs every 4xx response; the tests trigger validation errors and conflicts on purpose.
      const expected = /Failed to load resource: the server responded with a status of 4(09|22)/.test(message.text());
      if (message.type() === "error" && !expected) consoleErrors.push(`${page.url()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => consoleErrors.push(`${page.url()}: ${error.message}`));
  });
  test.afterAll(async () => {
    await page.close();
  });

  test("Mission Control shows the brand, navigation and labelled demo data", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Mission Control" })).toBeVisible();
    await expect(page.getByRole("img", { name: "DataLabsIQ" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(15);
    await expect(page.getByText("Demo workspace.")).toBeVisible();
    const orange = await page.getByRole("link", { name: "Start a project" }).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(orange).toBe("rgb(242, 138, 0)");
    await noOverflow(page);
  });

  test("validates the new project form and creates a project", async () => {
    await page.goto("/finder");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByText("Name must be at least 3 characters.")).toBeVisible();
    await page.getByLabel("Project name").fill("E2E retail analytics");
    await page.getByLabel("Project context").fill(BRIEF);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    projectUrl = page.url();
    await expect(page.getByRole("heading", { name: "E2E retail analytics" })).toBeVisible();
    await expect(page.getByText("Approve the requirements above to run the Finder.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Find architectures" })).toBeDisabled();
  });

  test("extracts requirements with evidence, lists unknowns, lets the user edit and approve", async () => {
    await page.getByRole("button", { name: "Extract requirements" }).click();
    await expect(page.getByText(/Extracted \d+ requirement\(s\) with local-rules/)).toBeVisible();
    await expect(page.getByLabel("Target platform", { exact: true })).toHaveValue("Microsoft Fabric, Azure");
    await expect(page.getByText("Extracted from your text").first()).toBeVisible();
    await expect(page.locator(".note.warn", { hasText: /unknown fields?:/ })).toContainText("Network connectivity");
    // Nothing was invented for a field the brief does not mention.
    await expect(page.getByLabel("Network connectivity state")).toHaveValue("unknown");

    await page.getByLabel("CI/CD state").selectOption("known");
    await page.getByRole("button", { name: "Save requirements" }).click();
    await expect(page.getByText("Enter a value, or mark the field unknown or not applicable.")).toBeVisible();
    await page.getByLabel("CI/CD", { exact: true }).fill("GitHub Actions and Terraform");
    await page.getByRole("button", { name: "Save and approve" }).click();
    await expect(page.getByRole("button", { name: "Requirements approved" })).toBeVisible();
    await expect(page.getByText("Requirements: approved")).toBeVisible();
  });

  test("ranks candidates with an explained score, gaps and sources, and compares them", async () => {
    await page.getByRole("button", { name: "Find architectures" }).click();
    const first = page.getByRole("article").first();
    await expect(first.getByRole("heading")).toContainText("1. Microsoft Fabric lakehouse for enterprise BI");
    await expect(first.getByText("Adapted reference").or(first.getByText("Exact reference"))).toBeVisible();
    await expect(first.getByText("Draft", { exact: true })).toBeVisible();
    const table = first.getByRole("table");
    await expect(table.getByRole("row")).toHaveCount(8);
    await expect(table).toContainText("Built on the target platform: Microsoft Fabric");
    await expect(first.getByText("Sources cited by this knowledge")).toBeVisible();
    await expect(first.getByRole("link", { name: "Microsoft Fabric documentation" })).toBeVisible();
    await expect(first.getByText("no prices are estimated")).toBeVisible();
    await expect(page.getByText(/scenarios? filtered out by hard constraints/)).toBeVisible();

    const articles = page.getByRole("article");
    await articles.nth(0).getByLabel("Compare").check();
    await articles.nth(1).getByLabel("Compare").check();
    await expect(page.getByRole("heading", { name: "Comparison" })).toBeVisible();
    await noOverflow(page);
  });

  test("creates a blueprint, edits the diagram and a section, and approves it", async () => {
    await page.getByRole("article").first().getByRole("button", { name: "Create blueprint from this" }).click();
    await expect(page).toHaveURL(/\/blueprint\?revision=/);
    await expect(page.locator(".react-flow__node")).toHaveCount(12);
    await expect(page.getByRole("button", { name: "Approve revision" })).toBeEnabled();

    await page.getByRole("button", { name: "+ Add component" }).click();
    await page.getByLabel("Label").fill("Alerting");
    await page.getByLabel("Type").selectOption("operations");
    await page.getByLabel("Technology").fill("TODO");
    await expect(page.locator(".react-flow__node")).toHaveCount(13);
    await expect(page.getByRole("button", { name: "Approve revision" })).toBeDisabled();

    await page.getByRole("navigation", { name: "Blueprint outline" }).getByRole("button", { name: /Rollback/ }).click();
    await page.getByLabel("Rollback (Markdown)").fill("Restore the previous semantic model from Git and repoint reports.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
    await page.reload();
    await expect(page.locator(".react-flow__node")).toHaveCount(13);

    await page.getByRole("button", { name: "Approve revision" }).click();
    await page.getByLabel(/Approval note/).fill("Reviewed in the e2e test.");
    await page.getByRole("button", { name: "Approve and lock" }).click();
    await expect(page.getByText("This revision is approved and read-only")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(page.getByText("Blueprint v1 approved")).toBeVisible();
    await expect(page.getByRole("heading", { name: /ADR-1: Adopt/ })).toBeVisible();
  });

  test("generates artifacts with a manifest, and protects a hand edit", async () => {
    await page.getByRole("link", { name: "3 · Artifact Factory" }).click();
    await page.getByRole("button", { name: "Generate 16 selected" }).click();
    await expect(page.getByRole("link", { name: "Download ZIP" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("16 files")).toBeVisible();

    await page.getByRole("button", { name: "docs/hld.md" }).click();
    await expect(page.getByRole("heading", { name: "High-level design (HLD)" })).toBeVisible();
    await expect(page.getByText("Generated — not validated.").first()).toBeVisible();
    await page.getByRole("tab", { name: "Edit" }).click();
    await page.getByLabel("Edit High-level design (HLD)").fill("# HLD\n\nEdited by hand.\n");
    await page.getByRole("button", { name: "Save as new version" }).click();
    await expect(page.getByText("Version 2 (shown)")).toBeVisible();

    await page.getByRole("button", { name: "Regenerate 16 selected" }).click();
    await expect(page.getByRole("dialog", { name: "Some artifacts were edited by hand" })).toBeVisible();
    await page.getByRole("button", { name: "Keep my edits" }).click();
    await expect(page.getByRole("link", { name: "Download ZIP" })).toHaveCount(2, { timeout: 30_000 });
    await page.getByRole("button", { name: "docs/hld.md" }).click();
    await expect(page.locator("pre.code, .prose").first()).toContainText("Edited by hand.");

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download ZIP" }).first().click();
    expect((await download).suggestedFilename()).toMatch(/^databrain-package-v1-[0-9a-f]{8}\.zip$/);
  });

  test("generates valid skills and builds a package", async () => {
    await page.getByRole("link", { name: "4 · AI Skill Factory" }).click();
    await page.getByRole("button", { name: "Generate skills" }).click();
    await expect(page.getByRole("button", { name: /scenario-e2e-retail-analytics/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /validate-e2e-retail-analytics/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /platform-microsoft-fabric/ })).toBeVisible();
    await expect(page.getByText(/\d+ error\(s\)/)).toHaveCount(0);
    await page.getByRole("button", { name: "Build package" }).click();
    await expect(page.getByRole("cell", { name: /e2e-retail-analytics-skills v1/ })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download ZIP" }).click();
    expect((await download).suggestedFilename()).toBe("e2e-retail-analytics-skills-v1.zip");
  });

  test("plans a deployment, runs a dry-run, shows evidence, and gates execution behind approval", async () => {
    await page.getByRole("link", { name: "5 · Deployment Studio" }).click();
    await expect(page.getByText("This is a simulator.")).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("dev-eu");
    await page.getByRole("button", { name: "Add environment" }).click();
    await expect(page.getByRole("cell", { name: "dev-eu" })).toBeVisible();
    await page.getByRole("button", { name: "Create plan" }).click();
    await expect(page.getByText("No cost estimate")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve execution…" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Execute…" })).toBeDisabled();

    await page.getByRole("button", { name: "Start dry-run" }).click();
    await expect(page.getByText(/Dry-run finished: \d+ passed.*Nothing was changed\./).first()).toBeVisible({ timeout: 30_000 });
    const checks = page.getByRole("table", { name: "Validation checks" });
    await expect(checks.getByRole("row", { name: /Authentication/ })).toContainText("Not run");
    await expect(checks.getByRole("row", { name: /Secret scan/ })).toContainText("passed");
    await checks.getByRole("row", { name: /Secret scan/ }).getByRole("button", { name: "View" }).click();
    await expect(checks.getByText("databrain-secret-scan")).toBeVisible();

    await page.getByRole("button", { name: "Approve execution…" }).click();
    const dialog = page.getByRole("dialog", { name: "Approve execution" });
    await dialog.getByLabel("What are you approving, and why?").fill("Rehearsal of the approval flow.");
    await dialog.getByLabel("Type the environment name to confirm").fill("wrong-env");
    await dialog.getByRole("button", { name: "Approve this plan" }).click();
    await expect(dialog.getByText("Type “dev-eu” to confirm the target.")).toBeVisible();
    await dialog.getByLabel("Type the environment name to confirm").fill("dev-eu");
    await dialog.getByRole("button", { name: "Approve this plan" }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Execute…" }).click();
    await page.getByRole("button", { name: "Run simulated execution" }).click();
    await expect(page.getByText(/Simulated execution finished.*No resources were created/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Execute…" })).toBeDisabled();
    await expect(page.getByRole("cell", { name: "Used" })).toBeVisible();
    await noOverflow(page);
  });

  test("the project is reachable from every delivery module and nothing logged a console error", async () => {
    for (const area of ["blueprint", "artifacts", "skills", "deployments"]) {
      await page.goto(`/studio/${area}`);
      await expect(page.getByRole("link", { name: /E2E retail analytics/ })).toBeVisible();
    }
    await page.goto(projectUrl);
    await expect(page.getByText("Blueprint v1 uses this")).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});

test.describe("knowledge", () => {
  test("search explains matches; items can be created, sourced, verified and edited with a guard", async ({ page }) => {
    await page.goto("/knowledge?q=private+endpoints+unity+catalog");
    await expect(page.getByRole("link", { name: "Azure Databricks lakehouse with Unity Catalog and private networking" })).toBeVisible();
    await expect(page.getByText(/^Why:/).first()).toBeVisible();

    await page.goto("/knowledge/new?type=best-practice");
    await page.getByRole("button", { name: "Create as draft" }).click();
    await expect(page.getByText("Title must be at least 3 characters.")).toBeVisible();
    await page.getByLabel("Title").fill("Tag every resource for cost allocation");
    await page.getByLabel("Summary").fill("Apply owner, environment and cost-centre tags at creation.");
    await page.getByRole("button", { name: "Create as draft" }).click();
    await expect(page).toHaveURL(/\/knowledge\/tag-every-resource-for-cost-allocation$/);
    await expect(page.getByRole("button", { name: "Mark verified" })).toBeDisabled();

    await page.getByRole("button", { name: "+ Add a source" }).click();
    await page.getByLabel("New source title").fill("Internal FinOps guideline");
    await page.getByRole("button", { name: "Add source", exact: true }).click();
    await expect(page.getByText("Internal FinOps guideline", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Mark verified" }).click();
    await page.getByRole("button", { name: "I have checked it — mark verified" }).click();
    await expect(page.getByText("Verified reference").first()).toBeVisible();

    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Summary").fill("Apply owner, environment and cost-centre tags when a resource is created.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("dialog", { name: "Edit a verified item?" })).toBeVisible();
    await page.getByRole("button", { name: "Save and return to draft" }).click();
    await expect(page).toHaveURL(/\/knowledge\/tag-every-resource-for-cost-allocation$/);
    await expect(page.getByText("Best practice · version 2 ·")).toBeVisible();
    await expect(page.getByText("was verified")).toBeVisible();
  });

  test("graph has a list alternative and node details; compare and AI workspace work", async ({ page }) => {
    await page.goto("/graph");
    await expect(page.locator("canvas").first()).toBeVisible();
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.getByRole("button", { name: "Delta Lake", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Delta Lake" })).toBeVisible();
    await expect(page.getByText(/Connections \(\d+\)/)).toBeVisible();
    await page.getByRole("button", { name: "Focus on neighbourhood" }).click();
    await expect(page.getByText("Showing the neighbourhood of")).toBeVisible();

    await page.goto("/compare");
    await page.getByLabel("Databricks").check();
    await page.getByLabel("Snowflake").check();
    await page.getByRole("button", { name: "Compare selected" }).click();
    await expect(page.getByRole("cell", { name: "Billing model" })).toBeVisible();

    await page.goto("/workspace");
    await expect(page.getByText("Retrieval only.")).toBeVisible();
    await page.getByLabel("Your question").fill("How does the medallion architecture work?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("link", { name: "Medallion architecture" })).toBeVisible();
    await page.getByLabel("Your question").fill("zzzqqqxxx unknown topic");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("DataBrain will not make up an answer")).toBeVisible();
  });

  test("core pages do not overflow on tablet and phone widths", async ({ page }) => {
    for (const viewport of [{ width: 820, height: 1100 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const path of ["/", "/finder", "/knowledge", "/scenarios", "/graph", "/compare", "/settings", "/workspace"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await noOverflow(page);
      }
    }
  });

  test("API returns the consistent error shape and rejects cross-site writes", async ({ request }) => {
    const missing = await request.get("/api/jobs/00000000-0000-0000-0000-000000000000");
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error).toMatchObject({ code: "not_found", message: expect.any(String), correlationId: expect.any(String) });
    const invalid = await request.post("/api/projects", { data: { name: "x" } });
    expect(invalid.status()).toBe(422);
    expect((await invalid.json()).error.fieldErrors.name).toBeDefined();
    const crossSite = await request.post("/api/projects", { data: { name: "Cross-site" }, headers: { origin: "https://evil.example" } });
    expect(crossSite.status()).toBe(403);
    const health = await request.get("/api/health");
    expect(await health.json()).toEqual({ status: "ok", database: "ok" });
  });
});

test.describe("accessibility", () => {
  test("core pages have no serious or critical axe violations", async ({ page }) => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    const projects = await (await page.request.get("/api/projects")).json();
    const projectId = projects.items.find((p: { name: string }) => p.name === "E2E retail analytics")?.id as string | undefined;
    const paths = ["/", "/finder", "/knowledge", "/knowledge/medallion-architecture", "/knowledge/new?type=scenario", "/graph", "/compare", "/workspace", "/settings"];
    if (projectId) paths.push(`/projects/${projectId}`, `/projects/${projectId}/blueprint`, `/projects/${projectId}/artifacts`, `/projects/${projectId}/skills`, `/projects/${projectId}/deployments`);
    const problems: string[] = [];
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      // The third-party diagram and graph canvases are excluded; each has a list alternative that is checked.
      const results = await new AxeBuilder({ page }).exclude(".react-flow").exclude("canvas").analyze();
      for (const v of results.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) {
        problems.push(`${path.replace(/[0-9a-f-]{36}/, ":id")}: ${v.id} (${v.nodes.length}) e.g. ${[...new Set(v.nodes.map((n) => n.html.slice(0, 110)))].slice(0, 4).join(" || ")}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
