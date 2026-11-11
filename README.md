# DataBrain by DataLabsIQ

A personal Data & AI Architecture Intelligence Platform. It keeps a knowledge base of scenarios, patterns and technologies, turns a project brief into ranked reference architectures with the reasons behind every score, and packages an approved blueprint into documents, IaC starters, agent skills and a gated deployment plan.

**Workflow:** project requirements → architecture candidates → approved blueprint → artifact package → agent skills → dry-run and approval → evidence.

**Lifecycle (DataBrain 2.0, phase 1):** each project can also run a delivery lifecycle — Initiate → Discover → Design → Build → Validate → Release → Operate → Improve & Retire — with stage owners, checklists, evidence references, approval gates, milestones and a risk register. DataBrain is the system of record for that lifecycle; the work itself still happens in the modules above and in your own delivery tools.

## What works

| Module | What you can do |
|---|---|
| Mission Control | Project and knowledge counts, review queue, recent activity; lifecycle figures (active lifecycles, blocked projects, overdue milestones, open high/critical risks, pending approvals), projects by stage, projects needing attention, upcoming milestones |
| Projects | Portfolio of every project with lifecycle status, current stage, stage completion, owner, next milestone, overdue marker and open risks; search, filter, sort; start a lifecycle |
| Project lifecycle | Start from a template; per stage: owner, reviewer, due date, notes, checklist (complete, waive with a reason, add items), evidence references (generated artifact, link, note), gate readiness with the exact blockers, approval request / approve / reject / withdraw with history, block, skip, reopen, activity |
| Milestones & Risks | Milestones with owner, due date, overdue state and a timeline; risk register with category, likelihood × impact score worked out by the server, owner, mitigation and status |
| Lifecycle Templates | The built-in eight-stage template per workspace; copy it, edit stages, checklists and gate conditions, set the workspace default, deactivate |
| Architecture Finder | Create a project, extract requirements from your text with the source sentence as evidence, mark each field known / unknown / not applicable, approve, rank scenarios on seven weighted factors, compare candidates, see what was filtered out and why |
| Solution Blueprint | 20 editable sections, an editable React Flow diagram (add, connect, edit, delete; Mermaid / draw.io / JSON export), decision records, validation, immutable approval, new revisions |
| Artifact Factory | 16 artifacts (HLD, LLD, ADRs, security design, runbook, diagrams, Terraform starter, CI pipeline, SQL scaffold, migration plan, test plan, cutover checklist), checks, version history and diff, hand-edit protection, manifest, ZIP and DOCX export |
| AI Skill Factory | Platform, pattern, scenario and validation skills with validated `SKILL.md`, dependencies, compatibility, package ZIP |
| Deployment Studio | Environments, hashed plan, dry-run, approval bound to plan hash + environment + expiry, evidence per check, run log |
| Knowledge | Library with search and review status, article pages with sources / relationships / versions, document import, graph explorer, scenario / pattern / migration / experience views, technology comparison |
| AI Workspace | Questions answered by quoting stored passages with citations |
| Settings | Providers, workspace settings, source register, audit log |

Text stored as Markdown (knowledge articles, blueprint sections, generated documents, skills, decision records, AI answers) is rendered with styled headings, nested and task lists, tables, call-outs and code blocks. A fenced `mermaid` block is drawn as a diagram with Diagram / Code views, copy, SVG download and an enlarged view; scenario pages and the generated HLD include the architecture diagram this way.

## Read this before relying on it

- **Generative AI is off by default.** With `LLM_PROVIDER=local`, requirement extraction is vocabulary and pattern matching over your own text and the AI Workspace only quotes stored passages. You can switch on Claude (see “Using Claude”). Artifacts and skills always come from fixed templates.
- **The starter knowledge library was researched by an AI, not reviewed by a person.** 54 of its 55 items were rewritten on 2026-11-11 from web searches of official documentation and cite the specific pages they rely on (212 in total), each with a note of what it supports. The research read search-result summaries and snippets, not whole pages. Every item loads as a draft labelled “AI-researched” with no verification date; check an item against its sources before you mark it reviewed or verified. One playbook has no vendor source and stays flagged “Demo”.
- **Nothing is deployed.** The only deployment adapter is a simulator. It runs real read-only checks on the generated files (checksums, syntax, secret scan) and reports everything that needs a real platform as “not run”. An approved execution rehearses the approval flow and creates nothing.
- **Scores are decision aids.** No prices, SKUs, network ranges or tenant IDs are ever generated; those are marked `TODO` or `PLACEHOLDER`.
- **Stage completion is not delivery progress.** The percentage on a lifecycle is completed-or-skipped required stages ÷ required stages. It says nothing about engineering effort, data quality, business value or whether anything was deployed. A risk score is likelihood × impact on 1–5 scales: a way to rank the register, not a forecast.
- **The lifecycle tracks; it does not execute or verify.** Checklist items are ticked by a person. Evidence is a reference — a generated artifact, a link or a note; no file is uploaded and DataBrain does not open the link. Three gates read real DataBrain records (requirements approved, blueprint approved, a successful dry-run of the current deployment plan). The dry-run is the simulator's, so the Release gate rehearses the flow; it does not show that a release happened. There are no connectors to Fabric, Databricks, Purview, Azure DevOps or GitHub, no test runs, and no production monitoring.
- **A project has no lifecycle until someone starts one.** Existing projects show “Lifecycle not started”. Nothing is back-filled or inferred from their requirements, blueprints or deployments.

## Run it locally

Requirements: Node.js 22, PostgreSQL 16 (or Docker).

```bash
docker compose up -d db
```

```bash
cp .env.example .env
```

```bash
npm install
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Open http://localhost:3000. In demo mode you are signed in as the seeded demo user. A sample project, “Demo: Retail analytics modernisation”, is ready for requirement extraction; its lifecycle is not started, so you can start one from **Projects**.

### Upgrading an existing database

```bash
npm run db:migrate
```

This applies `drizzle/0001_lifecycle.sql`, which only adds tables. Existing projects are not changed. Each workspace gets the built-in lifecycle template the first time lifecycle templates or a lifecycle are used in it (new workspaces get it when they are created), so no seed step is needed.

Without Docker, create the role and databases yourself: a `databrain` role with password `databrain`, owning databases `databrain` and `databrain_test`.

### Using Claude

Set these in `.env` (server-side only; `.env` is git-ignored) and restart the app:

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=<your key>
```

`ANTHROPIC_MODEL` is optional and defaults to `claude-opus-5-5`. With Claude on:

| Where | What Claude does | Guard |
|---|---|---|
| Project brief → Extract requirements | Reads the brief and fills the intake fields | Every fact must quote the sentence it came from; a fact whose quote is not in your text is discarded. You still review and approve. |
| Solution Blueprint → a section → “Draft with Claude” | Writes a draft of that section from the requirements, components and flows | Nothing is saved until you save; the section is labelled generated; unknown values are written as `TODO` / `PLACEHOLDER`. |
| AI Workspace | Writes an answer from the retrieved passages, with `[n]` citations | Instructed to use only those passages; shown as “Generated — not validated” above the passages themselves. |

Project briefs, requirements, component lists and retrieved knowledge passages are sent to the Anthropic API. If a request is declined by the model, the API retries it on a fallback model in the same call (`fallbacks: "default"`); the model that actually answered is shown and recorded in the audit log. If the key is missing or rejected, the feature reports the error — it does not fall back to the local rules.

**Not verified:** this integration was type-checked, unit-tested with a stubbed client, and run end to end against a local mock of the Messages API. It has not been run against the real Anthropic API, because no key was available where it was built.

### Loading the knowledge library into your own workspace

`npm run db:seed` fills only the demo workspace. A workspace created with `user:create` starts empty; load the library into it with:

```bash
npm run knowledge:load -- you@example.com
```

In PowerShell, run the script directly:

```powershell
npx tsx --env-file-if-exists=.env scripts/load-knowledge.ts you@example.com
```

It is safe to run again after pulling updates: it adds new items and refreshes library items nobody has touched. Anything you have edited, reviewed or verified is left alone.

### Accounts without demo mode

Set `DATABRAIN_DEMO_MODE=false` and a real `SESSION_SECRET`, then create a user:

```bash
DATABRAIN_NEW_PASSWORD="a-long-password" npm run user:create -- you@example.com "Your Name" "Your Workspace"
```

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` / `npm run build` / `npm run start` | Develop, build, serve |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm run test:unit` | Domain logic, no database |
| `npm run test:integration` | Services against `TEST_DATABASE_URL` (the database is wiped each run) |
| `npm run test:e2e` | Playwright against a production build (run `npm run build` first); resets and seeds the test database |
| `npm run db:generate` | Generate a migration after changing `src/server/db/schema.ts` |
| `npm run db:reset -- --force` | Drop and re-migrate the configured database |

## Checks run on 2026-11-11

| Check | Result |
|---|---|
| `npm run lint` | Clean |
| `npm run typecheck` | Clean |
| `npm run test:unit` | 29 passed |
| `npm run test:integration` | 23 passed |
| `npm run build` | Succeeded |
| `npm run test:e2e` | 14 passed, including an axe scan of 14 pages and overflow checks at 820 px and 390 px |

### Not verified

- `Dockerfile`, the `app` profile of `docker-compose.yml` and `.github/workflows/ci.yml` were written but never run: the authoring environment had no Docker daemon and no CI.
- Browsers other than Chromium.
- Behaviour under concurrent users or with large knowledge bases (search loads all embeddings in the workspace; the graph caps at 150 nodes).

## Architecture

```
src/app            Next.js routes: pages under (app)/, JSON API under api/
src/components     Shared UI (shell, badges, forms, dialogs, Markdown)
src/lib            Pure domain logic: scoring, diagram, vocabulary, validation, schemas,
                   lifecycle rules (lifecycle.ts) and their request schemas (lifecycle-schemas.ts)
src/server         Database, auth, audit, jobs, providers, services, seed
drizzle            SQL migrations
tests              unit / integration / e2e
```

Every service function takes a request context and scopes its queries to that workspace; a record in another workspace is reported as not found. Provider interfaces (`LLMProvider`, `EmbeddingProvider`, `Reranker`, `DocumentExtractor`, `ObjectStorage`, `DeploymentAdapter`, `SourceConnector`) are in `src/server/providers/types.ts`. `LLM_PROVIDER` accepts `local` or `anthropic`; the other providers are local only. Naming a provider that has no implementation is a configuration error — the app does not fall back to a local stand-in.

The lifecycle follows the same shape. `src/lib/lifecycle.ts` holds the built-in template, the stage transition matrix, the readiness evaluator, progress, risk score and overdue rules as pure functions; `src/server/services/lifecycle.ts` and `lifecycle-templates.ts` load the facts, enforce roles and parent/workspace checks, and write inside transactions; the routes under `src/app/api/projects/[projectId]/lifecycle`, `…/milestones`, `…/risks` and `src/app/api/lifecycle-templates` only validate and delegate. A project copies its template's stages and checklist when the lifecycle starts, so editing a template (which bumps its version) never changes a running lifecycle. Progress and risk scores are computed on every read and are not stored.

Security controls in place: signed HTTP-only session cookie, scrypt password hashes, role checks (owner / editor / viewer), same-origin check on state-changing requests, 2 MB body limit, per-user rate limit, login throttling, Zod validation at every API boundary, secret scan on generated files, redaction of evidence output, audit events for create / update / approve / export / deploy.

## Known limitations

- PDF export is not built (Markdown and DOCX are).
- Only `.md` and `.txt` documents can be imported.
- Jobs run in-process: a job running when the server restarts is reported as failed and must be started again.
- Rate limits are per process and in memory.
- No backup/restore tooling or metrics endpoint beyond `/api/health`.
- Lifecycle: one lifecycle per project; a running lifecycle cannot be moved to another template. Workspace members can only be added with `user:create` or directly in the database — there is no invitation screen, so a single-user workspace approves its own gates. An owner can approve a request they made themselves (no separation of duties is enforced). Due dates are calendar days in UTC. There are no notifications or reminders. Risks are closed, not deleted. Evidence cannot attach files.
- The diagram canvas and graph canvas are mouse-driven; each has a table/list alternative for keyboard use.

See `docs/IMPLEMENTATION-PLAN.md` for decisions, deviations from the build skills, the acceptance checklist and the next milestone.
