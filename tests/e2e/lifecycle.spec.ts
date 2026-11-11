import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { hashPassword } from "../../src/server/crypto";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://databrain:databrain@localhost:5432/databrain_test";
const PROJECT = "Lifecycle journey";
const BRIEF =
  "A logistics company wants one reporting platform for operations and finance. Source systems are an on-premises SQL Server ERP database and Salesforce. The target platform is Microsoft Fabric on Azure. Around 2 TB of history, loaded as a daily batch. About 300 report users use Power BI dashboards. Data must stay in the EU for GDPR. Users sign in with Microsoft Entra ID. The team is strong in SQL and Power BI.";
const PASSWORD = "e2e-lifecycle-password";
const VIEWER = "viewer.e2e@example.test";
const OUTSIDER = "outsider.e2e@example.test";

const consoleErrors: string[] = [];

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `horizontal overflow on ${page.url()}`).toBeLessThanOrEqual(1);
}

/** Call the API from inside the page, so the browser's own session cookie is used. */
function call(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ([m, p, b]) => {
      const response = await fetch(p as string, { method: m as string, headers: b === undefined ? undefined : { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
      return { status: response.status, json: (await response.json().catch(() => null)) as Record<string, unknown> | null };
    },
    [method, path, body] as const,
  );
}

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  const login = await call(page, "POST", "/api/auth/login", { email, password: PASSWORD });
  expect(login.status, `sign in as ${email}`).toBe(200);
  return page;
}

/** Set every checklist status control of the open stage to completed, one request at a time. */
async function completeChecklist(page: Page, expected: number) {
  const selects = page.locator('#checklist select[id^="status-"]');
  await expect(selects).toHaveCount(expected);
  for (let i = 0; i < expected; i += 1) {
    if ((await selects.nth(i).inputValue()) === "completed") continue;
    await selects.nth(i).selectOption("completed");
    await expect(selects.nth(i)).toHaveValue("completed");
    await expect(selects.nth(i)).toBeEnabled();
  }
}

const stages = (page: Page) => page.getByRole("navigation", { name: "Lifecycle stages" });
const stageLink = (page: Page, name: string) => stages(page).getByRole("link", { name: new RegExp(`^${name}\\b`) });
const gate = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Gate readiness" }) });
const dialog = (page: Page): Locator => page.getByRole("dialog");

async function requestAndApprove(page: Page, stage: string) {
  await page.getByRole("button", { name: "Request approval" }).click();
  await dialog(page).getByLabel("Reviewer", { exact: true }).selectOption({ label: "Demo Architect" });
  await dialog(page).getByLabel("What are you asking the reviewer to approve?").fill(`${stage} is ready for review.`);
  await dialog(page).getByRole("button", { name: "Send request" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText("Awaiting decision")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Approve and complete stage" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(gate(page).getByText("Gate passed")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // Two accounts that demo mode does not provide: a viewer of the demo workspace, and an owner of another workspace.
  const db = new Client({ connectionString: TEST_DB });
  await db.connect();
  try {
    const user = async (email: string, name: string) => (await db.query("insert into users (email, name, password_hash) values ($1, $2, $3) on conflict (email) do update set password_hash = excluded.password_hash returning id", [email, name, hashPassword(PASSWORD)])).rows[0].id as string;
    const viewer = await user(VIEWER, "Vera Viewer");
    await db.query("insert into memberships (user_id, workspace_id, role) select $1, w.id, 'viewer' from workspaces w where w.is_demo limit 1 on conflict do nothing", [viewer]);
    const outsider = await user(OUTSIDER, "Otto Outsider");
    const member = await db.query("select 1 from memberships where user_id = $1", [outsider]);
    if (!member.rowCount) {
      const workspace = (await db.query("insert into workspaces (name) values ('Other workspace') returning id")).rows[0].id as string;
      await db.query("insert into memberships (user_id, workspace_id, role) values ($1, $2, 'owner')", [outsider, workspace]);
    }
  } finally {
    await db.end();
  }
});

test.describe("project lifecycle journey", () => {
  let page: Page;
  let projectId: string;
  let base: string;
  const lifecycleView = async () => (await (await page.request.get(`/api/projects/${projectId}/lifecycle`)).json()) as { stages: { id: string; stageKey: string; reviewer: { id: string } | null }[] };
  const stageId = async (key: string) => (await lifecycleView()).stages.find((s) => s.stageKey === key)!.id;
  /** The demo user, who was made reviewer of Initiate. */
  const reviewerId = async () => (await lifecycleView()).stages[0]!.reviewer!.id;

  test.beforeAll(async ({ browser }) => {
    // An explicit context: the accessibility scan at the end needs one.
    page = await (await browser.newContext()).newPage();
    page.on("console", (message) => {
      // The browser logs every 4xx response; this journey triggers gate failures and validation errors on purpose.
      const expected = /Failed to load resource: the server responded with a status of 4(09|12|22)/.test(message.text());
      if (message.type() === "error" && !expected) consoleErrors.push(`${page.url()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => consoleErrors.push(`${page.url()}: ${error.message}`));
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("creates a project that has no lifecycle until one is started", async () => {
    await page.goto("/finder");
    await page.getByLabel("Project name").fill(PROJECT);
    await page.getByLabel("Project context").fill(BRIEF);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}\/requirements$/);
    projectId = page.url().match(/projects\/([0-9a-f-]{36})/)![1]!;
    base = `/projects/${projectId}`;

    await page.goto("/projects");
    const row = page.getByRole("row", { name: new RegExp(PROJECT) });
    await expect(row.getByText("Lifecycle not started")).toBeVisible();
    await expect(row.getByRole("button", { name: `Start lifecycle for ${PROJECT}` })).toBeVisible();
    // Nothing is inferred for a project without a lifecycle: no stage and no progress figure.
    await expect(row.getByText("%")).toHaveCount(0);

    await page.getByRole("link", { name: PROJECT, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${base}$`));
    await expect(page.getByText("Lifecycle not started").first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Project workspace" }).getByRole("link")).toHaveText(["Overview", "Lifecycle", "Milestones & Risks", "1 · Requirements & Finder", "2 · Solution Blueprint", "3 · Artifact Factory", "4 · AI Skill Factory", "5 · Deployment Studio"]);
  });

  test("starts the lifecycle from the default template with eight stages and their checklists", async () => {
    await page.getByRole("link", { name: "Lifecycle", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Lifecycle not started" })).toBeVisible();
    await page.getByRole("button", { name: "Start lifecycle" }).click();

    await expect(stages(page).getByRole("link")).toHaveCount(8);
    await expect(stages(page).getByRole("link")).toContainText(["Initiate", "Discover", "Design", "Build", "Validate", "Release", "Operate", "Improve & Retire"]);
    await expect(stageLink(page, "Initiate")).toContainText("In progress");
    await expect(stageLink(page, "Initiate")).toHaveAttribute("aria-current", "step");
    await expect(stageLink(page, "Discover")).toContainText("Not started");
    await expect(stageLink(page, "Improve & Retire")).toContainText("Optional");
    await expect(page.getByText("Data & AI Project Lifecycle · v1")).toBeVisible();
    await expect(page.getByText("0 of 7 required stages completed")).toBeVisible();
    await expect(page.getByText("0 of 5 required items done")).toBeVisible();
    for (const item of ["Business problem and objectives documented.", "Sponsor and business owner identified.", "Scope, exclusions, and success measures documented.", "Initial stakeholders and dependencies identified.", "Initial risks recorded."]) {
      await expect(page.locator("#checklist").getByText(item, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("Lifecycle: active")).toBeVisible();
    // A second start is refused rather than duplicated.
    const again = await page.request.post(`/api/projects/${projectId}/lifecycle`, { data: {} });
    expect(again.status()).toBe(409);
    expect((await again.json()).error.message).toContain("already has a lifecycle");
  });

  test("assigns an owner, a reviewer and a due date", async () => {
    await page.getByLabel("Stage owner").selectOption({ label: "Demo Architect" });
    await page.getByLabel("Reviewer").selectOption({ label: "Demo Architect" });
    await page.getByLabel("Due date").fill("2031-03-31");
    await page.getByLabel("Stage notes").fill("Kick-off agreed with the sponsor.");
    await page.getByRole("button", { name: "Save stage details" }).click();
    await expect(page.getByText("Stage details saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Stage owner")).toHaveValue(/[0-9a-f-]{36}/);
    await expect(page.getByLabel("Due date")).toHaveValue("2031-03-31");
    await expect(stageLink(page, "Initiate")).toContainText("due 31 Mar 2031");
    // A user ID from outside the workspace is not accepted as an owner.
    const outsider = await page.request.patch(`/api/projects/${projectId}/lifecycle/stages/${await stageId("initiate")}`, { data: { ownerId: "3f2b8c1e-5d7a-4c9b-8e1f-2a6d4b7c9e10" } });
    expect(outsider.status()).toBe(422);
    expect((await outsider.json()).error.fieldErrors.ownerId).toBeDefined();
  });

  test("completes the Initiate checklist, with one audited waiver, and passes its approval gate", async () => {
    await expect(page.getByRole("button", { name: "Request approval" })).toBeDisabled();
    await expect(gate(page).getByText("5 required checklist items are still open in Initiate")).toBeVisible();

    await page.getByRole("button", { name: "Waive “Sponsor and business owner identified.”" }).click();
    await dialog(page).getByRole("button", { name: "Waive item" }).click();
    await expect(dialog(page).getByText("Say why this item is being waived.")).toBeVisible();
    await dialog(page).getByLabel("Why is this item being waived?").fill("The sponsor is named in the programme charter.");
    await dialog(page).getByRole("button", { name: "Waive item" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator("#checklist").getByText("The sponsor is named in the programme charter.")).toBeVisible();

    await completeChecklist(page, 4);
    await expect(page.getByText("5 of 5 required items done")).toBeVisible();
    await expect(gate(page).getByText("Ready", { exact: true })).toBeVisible();
    await requestAndApprove(page, "Initiate");

    await expect(stageLink(page, "Initiate")).toContainText("Completed");
    await expect(page.getByText("1 of 7 required stages completed")).toBeVisible();
    await expect(page.getByRole("list", { name: "Approval history" }).getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByText("Waived required checklist item in “Initiate”")).toBeVisible();
    // A completed stage offers reopening, not editing.
    await expect(page.getByRole("button", { name: "Reopen stage" })).toBeVisible();
    await expect(page.locator('#checklist select[id^="status-"]')).toHaveCount(0);
  });

  test("holds Discover until the requirements are approved in Requirements & Finder", async () => {
    await stageLink(page, "Discover").click();
    await expect(page).toHaveURL(/stage=discover/);
    await page.getByRole("button", { name: "Start stage" }).click();
    await expect(stageLink(page, "Discover")).toContainText("In progress");
    await completeChecklist(page, 6);

    await expect(gate(page).getByText("Record and approve the project requirements before completing Discover.")).toBeVisible();
    await expect(gate(page).getByRole("link", { name: "Open Requirements & Finder" })).toHaveAttribute("href", `${base}/requirements`);
    await expect(page.getByRole("button", { name: "Request approval" })).toBeDisabled();
    // The server enforces the gate whatever the client sends.
    const id = await stageId("discover");
    const request = await page.request.post(`/api/projects/${projectId}/lifecycle/stages/${id}/approvals`, { data: { note: "Please approve Discover.", reviewerId: await reviewerId() } });
    expect(request.status()).toBe(412);
    expect((await request.json()).error.details.blockers.map((b: { code: string }) => b.code)).toEqual(["requirements_not_started"]);
    const forced = await page.request.patch(`/api/projects/${projectId}/lifecycle/stages/${id}`, { data: { status: "completed" } });
    expect(forced.status()).toBe(412);
    const invented = await page.request.patch(`/api/projects/${projectId}/lifecycle/stages/${id}`, { data: { status: "done" } });
    expect(invented.status()).toBe(422);

    await page.getByRole("link", { name: "1 · Requirements & Finder" }).click();
    await page.getByRole("button", { name: "Extract requirements" }).click();
    await expect(page.getByText(/Extracted \d+ requirement\(s\) with local-rules/)).toBeVisible();
    await page.getByRole("button", { name: "Approve requirements" }).click();
    await expect(page.getByRole("button", { name: "Requirements approved" })).toBeVisible();

    await page.getByRole("link", { name: "Lifecycle", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
    await expect(gate(page).getByText("Ready", { exact: true })).toBeVisible();
    await requestAndApprove(page, "Discover");
    await expect(page.getByText("2 of 7 required stages completed")).toBeVisible();
  });

  test("moves on to Design, which waits for an approved blueprint", async () => {
    await stageLink(page, "Design").click();
    await page.getByRole("button", { name: "Start stage" }).click();
    await expect(stageLink(page, "Design")).toContainText("In progress");
    await completeChecklist(page, 6);

    await expect(gate(page).getByText("Create and approve a Solution Blueprint before completing Design. This project has no blueprint yet.")).toBeVisible();
    await expect(gate(page).getByRole("link", { name: "Open Solution Blueprint" })).toHaveAttribute("href", `${base}/blueprint`);
    await expect(page.getByRole("button", { name: "Request approval" })).toBeDisabled();
    const id = await stageId("design");
    const request = await page.request.post(`/api/projects/${projectId}/lifecycle/stages/${id}/approvals`, { data: { note: "Please approve Design.", reviewerId: await reviewerId() } });
    expect(request.status()).toBe(412);
    expect((await request.json()).error.details.blockers[0].code).toBe("blueprint_missing");
    // Later stages cannot be started out of order.
    const build = await page.request.post(`/api/projects/${projectId}/lifecycle/stages/${await stageId("build")}/start`, { data: {} });
    expect(build.status()).toBe(412);
    await stageLink(page, "Build").click();
    await expect(page.getByText("This stage cannot start yet. Complete or skip “Design” first.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start stage" })).toHaveCount(0);
  });

  test("attaches a safe link and a note as evidence, and refuses an unsafe link", async () => {
    await stageLink(page, "Design").click();
    await page.getByRole("button", { name: "Add evidence" }).click();
    await dialog(page).getByLabel("Title").fill("Design review minutes");
    await dialog(page).getByLabel("URL").fill("javascript:alert(document.cookie)");
    await dialog(page).getByRole("button", { name: "Add evidence" }).click();
    await expect(dialog(page).getByText("Only http:// and https:// links can be stored as evidence.")).toBeVisible();
    await dialog(page).getByLabel("URL").fill("https://example.com/design-review/42");
    await dialog(page).getByLabel("Checklist item it supports").selectOption({ label: "Security, identity, and network design reviewed." });
    await dialog(page).getByRole("button", { name: "Add evidence" }).click();
    await expect(dialog(page)).toBeHidden();
    const evidence = page.locator("#evidence");
    await expect(evidence.getByRole("link", { name: "https://example.com/design-review/42" })).toHaveAttribute("rel", /noopener/);
    await expect(evidence.getByText("For checklist item: Security, identity, and network design reviewed.")).toBeVisible();

    await page.getByRole("button", { name: "Add evidence" }).click();
    await dialog(page).getByLabel("Evidence type").selectOption("note");
    await dialog(page).getByLabel("Title").fill("Architecture board outcome");
    await dialog(page).getByLabel("Note").fill("Reviewed by the architecture board; two actions carried into Build.");
    await dialog(page).getByRole("button", { name: "Add evidence" }).click();
    await expect(evidence.getByText("Architecture board outcome")).toBeVisible();

    // This project has no generated artifact yet, and the dialog says so instead of offering an empty choice.
    await page.getByRole("button", { name: "Add evidence" }).click();
    await dialog(page).getByLabel("Evidence type").selectOption("artifact");
    await expect(dialog(page).getByText("This project has no generated artifacts yet.")).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Add evidence" })).toBeDisabled();
    await dialog(page).getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Mark superseded: Architecture board outcome" }).click();
    await dialog(page).getByLabel("Why is this reference being superseded?").fill("Replaced by the signed minutes.");
    await dialog(page).getByRole("button", { name: "Mark superseded" }).click();
    await expect(evidence.getByText("Superseded by Demo Architect")).toBeVisible();
    await expect(evidence.getByText("Architecture board outcome")).toBeVisible();
    await expect(page.getByText("Added url evidence to “Design”: Design review minutes")).toBeVisible();
  });

  test("records a milestone and a risk with a server-side score", async () => {
    await page.getByRole("link", { name: "Milestones & Risks" }).click();
    await expect(page.getByRole("heading", { name: "No milestones yet" })).toBeVisible();
    await page.getByRole("button", { name: "Add milestone" }).click();
    await dialog(page).getByRole("button", { name: "Add milestone" }).click();
    await expect(dialog(page).getByText("Name must be at least 3 characters.")).toBeVisible();
    await dialog(page).getByLabel("Name").fill("Steering committee decision");
    await dialog(page).getByLabel("Due date").fill("2021-01-15");
    await dialog(page).getByLabel("Owner").selectOption({ label: "Demo Architect" });
    await dialog(page).getByRole("button", { name: "Add milestone" }).click();
    await expect(dialog(page)).toBeHidden();
    const milestone = page.getByRole("row", { name: /Steering committee decision/ });
    await expect(milestone).toContainText("Planned");
    await expect(milestone).toContainText("15 Jan 2021");
    await expect(milestone.getByText("Overdue")).toBeVisible();
    await expect(page.getByRole("list", { name: "Milestone timeline" })).toContainText("Steering committee decision");

    await page.getByRole("button", { name: "Add risk" }).click();
    await dialog(page).getByLabel("Risk", { exact: true }).fill("ERP extract window may be cut");
    await dialog(page).getByLabel("Category").selectOption("data");
    await dialog(page).getByLabel("Likelihood").selectOption("4");
    await dialog(page).getByLabel("Impact").selectOption("5");
    await dialog(page).getByLabel("Mitigation").fill("Agree a fixed nightly window with the ERP team.");
    await dialog(page).getByRole("button", { name: "Add risk" }).click();
    await expect(dialog(page)).toBeHidden();
    const risk = page.getByRole("row", { name: /ERP extract window may be cut/ });
    await expect(risk).toContainText("20");
    await expect(risk).toContainText("Critical");
    await expect(risk).toContainText("L4 × I5");
    await expect(page.getByText("1 open · 1 high or critical")).toBeVisible();
    // A severity supplied by the client is rejected; the score always comes from likelihood × impact.
    const forged = await page.request.post(`/api/projects/${projectId}/risks`, { data: { title: "Forged severity", likelihood: 1, impact: 1, severity: 25 } });
    expect(forged.status()).toBe(422);
    const range = await page.request.post(`/api/projects/${projectId}/risks`, { data: { title: "Out of range", likelihood: 7, impact: 1 } });
    expect(range.status()).toBe(422);
    expect((await range.json()).error.fieldErrors.likelihood).toBeDefined();
  });

  test("shows the stage, progress, overdue state and risk count in the project overview, the portfolio and Mission Control", async () => {
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page.getByText("Stage completion: 2 of 7 required stages completed or skipped.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Design", exact: true })).toBeVisible();
    await expect(page.getByText("1 open · 1 high or critical")).toBeVisible();
    await expect(page.locator("section", { has: page.getByRole("heading", { name: "Milestones", exact: true }) }).getByText("Steering committee decision")).toBeVisible();
    const modules = page.locator("section", { has: page.getByRole("heading", { name: "Delivery modules" }) });
    await expect(modules.getByRole("link", { name: /Requirements & Finder/ })).toContainText("Approved");
    await expect(modules.getByRole("link", { name: /Solution Blueprint/ })).toContainText("None");
    await expect(modules.getByRole("link", { name: /Deployment Studio/ })).toContainText("No plan");

    await page.goto(`/projects?q=${encodeURIComponent(PROJECT)}`);
    const row = page.getByRole("row", { name: new RegExp(PROJECT) });
    await expect(row.getByRole("link", { name: "Design" })).toBeVisible();
    await expect(row).toContainText("In progress");
    await expect(row).toContainText("29%");
    await expect(row).toContainText("2 of 7 stages");
    await expect(row).toContainText("Demo Architect");
    await expect(row).toContainText("Steering committee decision");
    await expect(row.getByText("Overdue")).toBeVisible();
    await expect(row.getByRole("link", { name: "1 open" })).toBeVisible();
    await expect(row.getByText("1 high")).toBeVisible();
    await expect(page.getByText("Showing 1 of")).toBeVisible();
    // Filters are part of the address, so a filtered view can be linked.
    await page.getByLabel("Current stage").selectOption("Design");
    await page.getByLabel("Sort by").selectOption("risk");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/stage=Design/);
    await expect(page.getByRole("row", { name: new RegExp(PROJECT) })).toBeVisible();
    await page.goto("/projects?status=on_hold");
    await expect(page.getByRole("heading", { name: "No project matches these filters" })).toBeVisible();
    await page.goto("/projects?status=not_started");
    await expect(page.getByRole("row", { name: new RegExp(PROJECT) })).toHaveCount(0);

    await page.goto("/");
    const kpi = (label: string) => page.getByRole("link", { name: new RegExp(`^${label}`) });
    await expect(kpi("Active lifecycles").locator("strong")).toHaveText("1");
    await expect(kpi("Projects blocked").locator("strong")).toHaveText("0");
    await expect(kpi("Overdue milestones").locator("strong")).toHaveText("1");
    await expect(kpi("Open high or critical risks").locator("strong")).toHaveText("1");
    await expect(kpi("Pending stage approvals").locator("strong")).toHaveText("0");
    const byStage = page.locator("section", { has: page.getByRole("heading", { name: "Projects by current stage" }) });
    await expect(byStage.getByRole("row", { name: /Design/ })).toContainText("1");
    const attention = page.locator("section", { has: page.getByRole("heading", { name: "Projects needing attention" }) });
    await expect(attention.getByRole("row", { name: new RegExp(PROJECT) })).toContainText("1 overdue milestone");
    const upcoming = page.locator("section", { has: page.getByRole("heading", { name: "Upcoming milestones" }) });
    await expect(upcoming.getByRole("row", { name: /Steering committee decision/ })).toContainText("Overdue");
    await expect(page.locator("section", { has: page.getByRole("heading", { name: "Lifecycle activity" }) }).getByText("Recorded critical risk “ERP extract window may be cut” (score 20)")).toBeVisible();
    // The existing Mission Control content is still there.
    await expect(page.getByRole("link", { name: "Start a project" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Knowledge review" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
    await noOverflow(page);
  });

  test("blocking a stage and updating the milestone and risk change the figures", async () => {
    await page.goto(`${base}/lifecycle?stage=design`);
    await page.getByRole("button", { name: "Mark blocked" }).click();
    await dialog(page).getByRole("button", { name: "Mark blocked" }).click();
    await expect(dialog(page).getByText("Say what is blocking the stage.")).toBeVisible();
    await dialog(page).getByLabel("What is blocking this stage?").fill("Waiting for the network team's address plan.");
    await dialog(page).getByRole("button", { name: "Mark blocked" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Waiting for the network team's address plan." })).toBeVisible();
    await expect(stageLink(page, "Design")).toContainText("Blocked");

    await page.goto("/");
    await expect(page.getByRole("link", { name: /^Projects blocked/ }).locator("strong")).toHaveText("1");
    await expect(page.locator("section", { has: page.getByRole("heading", { name: "Projects needing attention" }) }).getByRole("row", { name: new RegExp(PROJECT) })).toContainText("1 blocked stage");

    await page.goto(`${base}/lifecycle?stage=design`);
    await page.getByRole("button", { name: "Resume stage" }).click();
    await expect(stageLink(page, "Design")).toContainText("In progress");

    await page.goto(`${base}/milestones`);
    await page.getByRole("button", { name: "Complete Steering committee decision" }).click();
    const milestone = page.getByRole("row", { name: /Steering committee decision/ });
    await expect(milestone).toContainText("Completed");
    await expect(milestone.getByText("Overdue")).toHaveCount(0);
    await page.getByRole("button", { name: "Edit ERP extract window may be cut" }).click();
    await dialog(page).getByLabel("Status").selectOption("mitigating");
    await dialog(page).getByLabel("Likelihood").selectOption("2");
    await dialog(page).getByRole("button", { name: "Save risk" }).click();
    await expect(dialog(page)).toBeHidden();
    const risk = page.getByRole("row", { name: /ERP extract window may be cut/ });
    await expect(risk).toContainText("Mitigating");
    await expect(risk).toContainText("10");
    await page.getByRole("button", { name: "Resolve ERP extract window may be cut" }).click();
    await expect(risk).toContainText("Resolved");
    await expect(page.getByText("0 open · 0 high or critical")).toBeVisible();
    await page.getByLabel("Show risks").selectOption("open");
    await expect(page.getByText("No risk matches this filter.")).toBeVisible();

    await page.goto(`/projects?q=${encodeURIComponent(PROJECT)}`);
    const row = page.getByRole("row", { name: new RegExp(PROJECT) });
    await expect(row.getByText("Overdue")).toHaveCount(0);
    await expect(row.getByText("1 high")).toHaveCount(0);
    await page.goto("/");
    await expect(page.getByRole("link", { name: /^Overdue milestones/ }).locator("strong")).toHaveText("0");
    await expect(page.getByRole("link", { name: /^Open high or critical risks/ }).locator("strong")).toHaveText("0");
    await expect(page.getByRole("link", { name: /^Projects blocked/ }).locator("strong")).toHaveText("0");
  });

  test("reopening a completed stage needs a reason and holds later stages for review", async () => {
    await page.goto(`${base}/lifecycle?stage=discover`);
    await page.getByRole("button", { name: "Reopen stage" }).click();
    await dialog(page).getByLabel("Why is this stage being reopened?").fill("A KPI definition changed.");
    await dialog(page).getByRole("button", { name: "Reopen stage" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(stageLink(page, "Discover")).toContainText("In progress");
    await expect(stageLink(page, "Design")).toContainText("Blocked");
    await expect(page.getByText("1 of 7 required stages completed")).toBeVisible();
    await expect(page.getByRole("list", { name: "Approval history" }).getByText("Approved — voided")).toBeVisible();
    await stageLink(page, "Design").click();
    await expect(page.getByRole("alert").filter({ hasText: "Earlier stage “Discover” was reopened: A KPI definition changed." })).toBeVisible();
    // The held stage keeps its work.
    await expect(page.locator("#evidence").getByText("Design review minutes")).toBeVisible();
    await expect(page.getByText("6 of 6 required items done")).toBeVisible();

    await stageLink(page, "Discover").click();
    await requestAndApprove(page, "Discover");
    await stageLink(page, "Design").click();
    await page.getByRole("button", { name: "Resume stage" }).click();
    await expect(stageLink(page, "Design")).toContainText("In progress");
    await expect(page.getByText("2 of 7 required stages completed")).toBeVisible();
  });

  test("a custom template can be created and edited without changing the running lifecycle", async () => {
    await page.goto("/lifecycle-templates");
    await expect(page.getByRole("heading", { name: "Data & AI Project Lifecycle", exact: true })).toBeVisible();
    await expect(page.getByText("Workspace default")).toBeVisible();
    await expect(page.getByRole("region", { name: /^Stage \d+:/ })).toHaveCount(8);
    await page.getByRole("button", { name: "Create template" }).click();
    await expect(page.getByText("Name must be at least 3 characters.")).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Lean analytics delivery");
    await page.getByRole("button", { name: "Create template" }).click();
    await expect(page).toHaveURL(/template=[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: "Lean analytics delivery", exact: true })).toBeVisible();

    const first = page.getByRole("region", { name: /^Stage 1:/ });
    await first.getByLabel("Stage name").fill("Mobilise");
    await page.getByRole("button", { name: "Remove stage Improve & Retire" }).click();
    await expect(page.getByRole("region", { name: /^Stage \d+:/ })).toHaveCount(7);
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template saved as version 2.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("region", { name: "Stage 1: Mobilise" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Lifecycle templates" }).getByRole("link", { name: /Lean analytics delivery/ })).toContainText("v2 · 7 stages");
    // An unknown gate rule is rejected, not ignored.
    const templateId = new URL(page.url()).searchParams.get("template");
    const unknown = await page.request.put(`/api/lifecycle-templates/${templateId}`, { data: { name: "Lean analytics delivery", expectedVersion: 2, stages: [{ stageKey: "mobilise", name: "Mobilise", readinessRules: ["tests_passed"] }] } });
    expect(unknown.status()).toBe(422);

    await page.goto(`${base}/lifecycle`);
    await expect(stages(page).getByRole("link")).toHaveCount(8);
    await expect(stageLink(page, "Initiate")).toBeVisible();
    await expect(page.getByText("Data & AI Project Lifecycle · v1")).toBeVisible();
  });

  test("a viewer can inspect the lifecycle but cannot change anything", async ({ browser }) => {
    const viewer = await signIn(browser, VIEWER);
    await viewer.goto(`${base}/lifecycle?stage=design`);
    await expect(viewer.getByRole("heading", { name: "Design", exact: true })).toBeVisible();
    await expect(stages(viewer).getByRole("link")).toHaveCount(8);
    await expect(viewer.locator("#checklist").getByText("Solution blueprint completed.")).toBeVisible();
    await expect(viewer.locator("#evidence").getByText("Design review minutes")).toBeVisible();
    for (const name of ["Request approval", "Mark blocked", "Skip stage", "Add evidence", "Add item", "Save stage details", "Put on hold"]) {
      await expect(viewer.getByRole("button", { name }), name).toHaveCount(0);
    }
    await expect(viewer.locator("#checklist select")).toHaveCount(0);
    await viewer.goto(`${base}/milestones`);
    await expect(viewer.getByRole("row", { name: /Steering committee decision/ })).toBeVisible();
    await expect(viewer.getByRole("button", { name: /Add milestone|Add risk|Edit |Resolve |Delete / })).toHaveCount(0);
    await viewer.goto("/projects");
    await expect(viewer.getByRole("row", { name: new RegExp(PROJECT) })).toBeVisible();
    await expect(viewer.getByRole("link", { name: "Create project" })).toHaveCount(0);
    await expect(viewer.getByRole("button", { name: /Start lifecycle/ })).toHaveCount(0);
    await viewer.goto("/lifecycle-templates");
    await expect(viewer.getByText("You have read-only access to lifecycle templates.")).toBeVisible();
    await expect(viewer.getByRole("button", { name: /Save template|Create template|Deactivate/ })).toHaveCount(0);

    // The API refuses a viewer whatever the page shows.
    const design = await stageId("design");
    const item = ((await call(viewer, "GET", `/api/projects/${projectId}/lifecycle`)).json as { stages: { stageKey: string; checklist: { id: string }[] }[] }).stages.find((s) => s.stageKey === "design")!.checklist[0]!.id;
    const attempts: [string, string, unknown][] = [
      ["PATCH", `/api/projects/${projectId}/lifecycle`, { status: "on_hold" }],
      ["PATCH", `/api/projects/${projectId}/lifecycle/stages/${design}`, { notes: "viewer" }],
      ["POST", `/api/projects/${projectId}/lifecycle/stages/${design}/block`, { reason: "viewer block" }],
      ["PATCH", `/api/projects/${projectId}/lifecycle/stages/${design}/checklist/${item}`, { status: "pending" }],
      ["POST", `/api/projects/${projectId}/lifecycle/stages/${design}/checklist/${item}/waive`, { reason: "viewer waiver" }],
      ["POST", `/api/projects/${projectId}/lifecycle/stages/${design}/evidence`, { evidenceType: "note", title: "Viewer note", note: "x" }],
      ["POST", `/api/projects/${projectId}/lifecycle/stages/${design}/approvals`, { note: "viewer request" }],
      ["POST", `/api/projects/${projectId}/milestones`, { name: "Viewer milestone" }],
      ["POST", `/api/projects/${projectId}/risks`, { title: "Viewer risk", likelihood: 1, impact: 1 }],
      ["POST", "/api/lifecycle-templates", { name: "Viewer template" }],
    ];
    for (const [method, path, body] of attempts) {
      const result = await call(viewer, method, path, body);
      expect(result.status, `${method} ${path}`).toBe(403);
      expect((result.json as { error: { code: string } }).error.code).toBe("forbidden");
    }
    await viewer.context().close();
  });

  test("another workspace cannot see or change this project", async ({ browser }) => {
    const outsider = await signIn(browser, OUTSIDER);
    await outsider.goto(`${base}/lifecycle`);
    await expect(outsider.getByRole("heading", { name: "Not found" })).toBeVisible();
    await outsider.goto("/projects");
    await expect(outsider.getByRole("heading", { name: "No projects yet" })).toBeVisible();
    await expect(outsider.getByText(PROJECT)).toHaveCount(0);

    const design = await stageId("design");
    const templates = (await (await page.request.get("/api/lifecycle-templates")).json()) as { items: { id: string }[] };
    const attempts: [string, string, unknown][] = [
      ["GET", `/api/projects/${projectId}/lifecycle`, undefined],
      ["POST", `/api/projects/${projectId}/lifecycle`, {}],
      ["PATCH", `/api/projects/${projectId}/lifecycle/stages/${design}`, { notes: "outsider" }],
      ["POST", `/api/projects/${projectId}/lifecycle/stages/${design}/start`, {}],
      ["GET", `/api/projects/${projectId}/lifecycle/stages/${design}/evidence`, undefined],
      ["GET", `/api/projects/${projectId}/milestones`, undefined],
      ["POST", `/api/projects/${projectId}/risks`, { title: "Outsider risk", likelihood: 1, impact: 1 }],
      ["GET", `/api/lifecycle-templates/${templates.items[0]!.id}`, undefined],
    ];
    for (const [method, path, body] of attempts) {
      const result = await call(outsider, method, path, body);
      expect(result.status, `${method} ${path}`).toBe(404);
      expect((result.json as { error: { code: string } }).error.code).toBe("not_found");
    }
    // The other workspace has its own default template and none of the demo workspace's.
    const own = (await call(outsider, "GET", "/api/lifecycle-templates")).json as { items: { id: string; name: string }[] };
    expect(own.items.map((t) => t.name)).toEqual(["Data & AI Project Lifecycle"]);
    expect(templates.items.map((t) => t.id)).not.toContain(own.items[0]!.id);
    await outsider.context().close();
  });

  test("the lifecycle API validates input, hides unknown records and rejects cross-site writes", async ({ request }) => {
    const lifecycle = `/api/projects/${projectId}/lifecycle`;
    const design = await stageId("design");
    const missing = "00000000-0000-4000-8000-000000000000";
    for (const path of [`/api/projects/${missing}/lifecycle`, `/api/projects/${missing}/milestones`, `/api/projects/${missing}/risks`, `/api/lifecycle-templates/${missing}`, `${lifecycle}/stages/${missing}/evidence`, `${lifecycle}/stages/not-a-uuid/checklist`]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      expect((await response.json()).error).toMatchObject({ code: "not_found", message: expect.any(String), correlationId: expect.any(String) });
    }
    const notFound: [string, unknown][] = [
      [`${lifecycle}/stages/${missing}/start`, {}],
      [`${lifecycle}/stages/${design}/checklist/${missing}/waive`, { reason: "No such item." }],
      [`${lifecycle}/stages/${design}/approvals/${missing}/approve`, {}],
      [`${lifecycle}/stages/${design}/evidence/${missing}/supersede`, { reason: "No such evidence." }],
    ];
    for (const [path, data] of notFound) expect((await request.post(path, { data })).status(), path).toBe(404);

    const invalid: [string, string, unknown, string][] = [
      ["POST", `${lifecycle}/stages/${design}/block`, {}, "reason"],
      ["POST", `${lifecycle}/stages/${design}/reopen`, { reason: " " }, "reason"],
      ["POST", `${lifecycle}/stages/${design}/checklist`, { title: "x" }, "title"],
      ["POST", `${lifecycle}/stages/${design}/evidence`, { evidenceType: "url", title: "Unsafe", url: "data:text/html,<script>alert(1)</script>" }, "url"],
      ["POST", `${lifecycle}/stages/${design}/evidence`, { evidenceType: "upload", title: "A file" }, "evidenceType"],
      ["POST", `${lifecycle}/stages/${design}/approvals`, { note: "" }, "note"],
      ["PATCH", `${lifecycle}/stages/${design}`, { dueAt: "31/12/2030" }, "dueAt"],
      ["PATCH", lifecycle, { status: "not_started" }, "status"],
      ["POST", `/api/projects/${projectId}/milestones`, { name: "Go-live", status: "late" }, "status"],
      ["POST", `/api/projects/${projectId}/risks`, { title: "No scores" }, "likelihood"],
    ];
    for (const [method, path, data, field] of invalid) {
      const response = await request.fetch(path, { method, data });
      expect(response.status(), `${method} ${path}`).toBe(422);
      const error = (await response.json()).error;
      expect(error.code).toBe("validation_error");
      expect(error.fieldErrors[field], `${path} ${field}`).toBeDefined();
    }
    const badJson = await request.post(`${lifecycle}/stages/${design}/block`, { headers: { "content-type": "application/json" }, data: "{not json" });
    expect(badJson.status()).toBe(422);

    for (const [method, path, data] of [["POST", lifecycle, {}], ["PATCH", `${lifecycle}/stages/${design}`, { notes: "cross-site" }], ["POST", `/api/projects/${projectId}/milestones`, { name: "Cross-site" }], ["POST", "/api/lifecycle-templates", { name: "Cross-site" }]] as const) {
      const response = await request.fetch(path, { method, data, headers: { origin: "https://evil.example" } });
      expect(response.status(), `${method} ${path}`).toBe(403);
    }
    expect((await (await request.get(`/api/projects/${projectId}/milestones`)).json()).items.map((m: { name: string }) => m.name)).toEqual(["Steering committee decision"]);
  });

  test("lifecycle pages fit tablet and phone widths", async () => {
    // The bare lifecycle address redirects to the current stage; it should land on a pinned stage address.
    await page.goto(`${base}/lifecycle`);
    await expect(page).toHaveURL(/lifecycle\?stage=design$/);
    const paths = ["/projects", "/lifecycle-templates", base, `${base}/lifecycle?stage=design`, `${base}/lifecycle?stage=initiate`, `${base}/milestones`, `${base}/requirements`, "/"];
    for (const viewport of [{ width: 820, height: 1100 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const path of paths) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await noOverflow(page);
      }
      // Dialogs must fit too.
      await page.goto(`${base}/milestones`);
      await page.getByRole("button", { name: "Add risk" }).click();
      await expect(dialog(page)).toBeVisible();
      await noOverflow(page);
      await dialog(page).getByRole("button", { name: "Cancel" }).click();
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("lifecycle pages have no serious or critical axe violations and logged no console errors", async () => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    const problems: string[] = [];
    const scan = async (label: string) => {
      const results = await new AxeBuilder({ page }).analyze();
      for (const v of results.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) {
        problems.push(`${label}: ${v.id} (${v.nodes.length}) e.g. ${[...new Set(v.nodes.map((n) => n.html.slice(0, 110)))].slice(0, 4).join(" || ")}`);
      }
    };
    for (const path of ["/", "/projects", "/lifecycle-templates", base, `${base}/lifecycle?stage=design`, `${base}/lifecycle?stage=initiate`, `${base}/lifecycle?stage=build`, `${base}/milestones`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await scan(path.replace(/[0-9a-f-]{36}/, ":id"));
    }
    await page.goto(`${base}/lifecycle?stage=design`);
    await page.getByRole("button", { name: "Add evidence" }).click();
    await scan("add evidence dialog");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await page.goto(`${base}/milestones`);
    await page.getByRole("button", { name: "Add risk" }).click();
    await scan("add risk dialog");
    expect(problems).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
