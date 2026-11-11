# DataBrain implementation plan

Written from the `databrain-*` skills. Phase numbers follow the orchestrator's build plan.
Status reflects what is in the repository and was run on 2026-11-11; see the README for commands and results.

## Starting point

The repository was empty (no commits, no code). Nothing existing had to be preserved.

## Decisions

| Area | Decision | Why |
|---|---|---|
| Topology | Modular monolith: Next.js 16 App Router (UI + API routes), TypeScript strict | Recommended topology; no service sprawl |
| Database | PostgreSQL 16, Drizzle ORM, one SQL migration generated from `src/server/db/schema.ts` | System of record with reproducible migrations |
| Search | PostgreSQL full-text (`tsvector`, GIN) + a local hashing embedding stored as `real[]`, combined in the service | Works with no extension and no paid service; pgvector stays optional |
| Auth | Signed session cookie (HMAC), scrypt passwords, workspace membership with owner/editor/viewer; demo mode signs anonymous visitors in as the seeded demo user | An auth boundary every service call goes through, with zero setup for local demo |
| Providers | Interfaces in `src/server/providers/types.ts`; local deterministic implementations for everything, plus an optional Anthropic `LLMProvider` | Runs offline; an unknown provider name is an error, never a silent fallback |
| Jobs | Persisted `generation_jobs` rows, in-process runner, UI polls | No queue infrastructure for an MVP; state survives reloads |
| UI kit | Hand-written components and CSS classes ported from the brand reference, Tailwind 4 for tokens | Closest match to the reference HTML; see deviations |

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 Discovery | Repo inspection, skills and brand reference read, this plan | Done |
| 1 Foundation and brand | App shell, tokens, logo, navigation (15 entries), schema, migration, auth boundary, providers, Docker files, seed | Done — Docker files not run (no daemon available) |
| 2 Knowledge intelligence | CRUD, versions, sources, typed relationships, hybrid search with reasons, import to review queue, Cytoscape graph with list alternative, review/verify/stale | Done |
| 3 Scenarios and Finder | Scenario attributes, intake, rule-based extraction with evidence, approval, hard filters, seven-factor scoring, editable weights, comparison, run history | Done |
| 4 Solution Blueprint | Revisions with optimistic locking, 20 sections, React Flow editor, ADRs, validation, immutable approval, clone to new revision | Done |
| 5 Artifact Factory | 16 artifact templates, validation, immutable manifest, version history, diff, hand-edit protection, ZIP export, DOCX export | Done — PDF not built |
| 6 AI Skill Factory | Platform/pattern/scenario/validation skills, SKILL.md validation, dependencies, compatibility, conflict notes, package ZIP | Done |
| 7 Deployment Studio | Environments, hashed plan, dry-run, approval bound to hash + environment + expiry (single use), simulator adapter, checks, evidence, log | Done — simulator only, no real platform adapter |
| 8 Hardening | Lint, typecheck, unit, integration, e2e, axe scan, responsive checks, production build, README | Done — backup/restore and observability not built |

## Data model

Entities map to tables in `src/server/db/schema.ts`. Deliberate simplifications:

- Scenario, Playbook, ArchitecturePattern, BestPractice, MigrationStrategy, Domain, Technology and Capability are **types of `knowledge_items`** with typed `attributes`, not separate tables. They share provenance, review and relationship behaviour.
- ArchitectureNode and ArchitectureEdge live in the revision's `diagram` JSON, each with a stable ID, provenance and requirement trace. Constraints are requirement rows.
- Tags are a text array on the item.

Integrity rules implemented: UUID keys, workspace scope on every query, unique version per parent, approved revisions immutable, sources and evidence protected by `ON DELETE RESTRICT` with no delete path, cross-workspace reads return not-found.

## Acceptance checklist

| # | Criterion | Evidence |
|---|---|---|
| 1 | Create/edit/archive a project | `tests/e2e` “creates a project”; `PATCH /api/projects/:id` |
| 2 | Extraction returns facts, unknowns, assumptions; edit and approve | unit “local requirement extraction”; integration “extracts requirements…”, “keeps user edits…” |
| 3 | Ranked candidates with factor breakdown, sources, gaps, trade-offs | integration “ranks candidates…”; e2e “ranks candidates…” |
| 4 | Compare candidates and record a decision | e2e comparison; ADR created with each blueprint; decisions panel |
| 5 | Create/edit/version blueprint and diagram | integration “creates an editable blueprint…”, “approves a revision…”; e2e blueprint test |
| 6 | Generate artifacts; manifest traces to revision and sources | integration “generates traceable artifacts…” |
| 7 | Skill package with valid SKILL.md and dependencies | integration “generates a valid, composable skill package” |
| 8 | Dry-run default; approval required to execute | integration “binds approval…”, “invalidates approvals…” |
| 9 | Validation results and evidence persisted and viewable | integration dry-run test; e2e evidence view |
| 10 | Knowledge provenance, review status, relationships, search | integration “knowledge intelligence” suite |
| Eng | Cross-workspace access denied | integration “denies all cross-workspace access” (23 calls) |
| UI | No horizontal overflow at 820 and 390 px; no serious axe violations | e2e “core pages do not overflow…”, “accessibility” |

## Deviations from the skills

- **shadcn/ui, React Hook Form, TanStack Query, ECharts are not used.** Components are hand-written against the brand CSS; forms use controlled state with server-side Zod validation surfaced inline; there are no analytics charts, so no chart library.
- **Primary buttons use navy text on brand orange**, not white as in the reference: white on `#f28a00` is 2.4:1 and fails contrast.
- **The top bar reads “DataBrain”** with the DataLabsIQ logo and “by DATALABSIQ” endorsement, in place of the reference's “JEV Mission Control”.
- **MinIO is not in Docker Compose.** Object storage is a local-filesystem adapter behind the `ObjectStorage` interface.
- **`SourceConnector` is an interface only**; imports are manual uploads.

## Risks and open items

- The knowledge library is AI-researched (web search of official documentation, page-level sources recorded) but not human-reviewed. Every item is a draft; nothing should be relied on until a person verifies it. Product names and limits in it will go stale.
- Requirement extraction is vocabulary matching. It misses anything phrased outside its vocabulary (reported as unknown) and can misread unusual sentences; the review step is the control.
- The in-process job runner loses a running job on restart (reported as failed, never as running forever). A multi-instance deployment needs a real queue.
- Rate limiting and login throttling are in-memory, per process.

## Next milestone

1. ~~A generative `LLMProvider`~~ — added: `AnthropicProvider` (extraction with a quote-grounding check, section drafting, cited answers). Still to do: run it against the real API and tune the prompts on real briefs.
2. A real `DeploymentAdapter` (Terraform plan/validate first), with credentials and scope agreed.
3. PDF export; pgvector-backed embeddings; a persistent job queue.

---

# DataBrain 2.0 — Phase 1: Lifecycle Management Foundation

Added on 2026-11-11 on top of the application described above. Nothing above was rewritten; this section records what the lifecycle release added, the decisions taken where the brief left room, and what was deliberately left out.

## Starting point

The repository matched the brief's baseline (modular monolith, `route(...)` wrapper, `Ctx`-scoped services, `audit(...)`, Drizzle migrations, Vitest and Playwright). Baseline checks were run before any change: lint and typecheck clean, 29 unit and 23 integration tests passing.

Workspaces are created in one place, `ensureWorkspace` in `src/server/seed/run.ts`, which is used by the demo seed, `user:create` and the test setup. There is no workspace-creation API.

## Scope delivered

| Area | What was built |
|---|---|
| Domain rules | `src/lib/lifecycle.ts`: enums, the built-in eight-stage template with its checklists, stage and lifecycle transition matrices, `stageStartCheck`, the readiness evaluator (six rule types, machine-readable blockers with messages and deep-link paths), progress, risk score and level, overdue, evidence URL check. Pure functions, no database |
| Schema | Migration `0001_lifecycle.sql` adds ten tables: `lifecycle_templates`, `lifecycle_stage_definitions`, `lifecycle_checklist_definitions`, `project_lifecycles`, `project_stage_instances`, `project_checklist_items`, `stage_approvals`, `stage_evidence`, `project_milestones`, `project_risks`. `0000_init.sql` is unchanged |
| Templates | Built-in template provisioned per workspace, idempotently and under an advisory lock: at workspace creation, and lazily for workspaces that predate the feature. Custom templates by copy, versioned edits, one active default per workspace (partial unique index), deactivate/reactivate |
| Lifecycle | One lifecycle per project (unique index, conflict on a second start). Stage and checklist snapshots at start. Start, block, resume, skip, complete, reopen; owner, reviewer, due date, notes |
| Checklist | Complete, reopen, waive with a mandatory reason, add project items, edit, delete optional project items only |
| Evidence | References to a generated artifact revision of the same project, an http(s) URL, or a note. Append-only; superseded with a reason, never edited or deleted |
| Approvals | Request, approve, reject, withdraw. One open request per stage (partial unique index). History kept; an approved gate is voided, not deleted, when its stage is reopened |
| Milestones and risks | CRUD for milestones (with delete) and risks (no delete), overdue from the server date, score derived from likelihood × impact |
| Portfolio | `getPortfolio` and `getLifecyclePortfolioStats`: six queries regardless of project count |
| API | 23 route files under `/api/lifecycle-templates` and `/api/projects/:projectId/{lifecycle,milestones,risks}`, all through `route(...)` with Zod schemas from `src/lib/lifecycle-schemas.ts` |
| UI | `/projects` (portfolio), `/projects/:id` (overview), `/projects/:id/lifecycle`, `/projects/:id/milestones` (milestones and risks), `/lifecycle-templates`; Mission Control lifecycle section; sidebar and project tabs |
| Audit | Every lifecycle change writes an event whose action starts with `lifecycle.`; stage-scoped events carry the stage ID so a stage's history can be listed |

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Completing a gated stage | Approving the request completes the stage in the same transaction, after re-checking the gate. “Complete stage” exists only for stages without an approval gate | The reviewer's decision is the gate. A separate click after approval would leave a window where the approval and the stage disagree |
| Request before approve | A stage can be sent for approval only when every other gate condition holds; the reviewer cannot approve if one stopped holding in the meantime | Brief §3.4 and §4.1; the gate is evaluated from stored records at both moments |
| Frozen while under review | Checklist and evidence cannot change while a request is open or once a stage is completed or skipped | The reviewer approves what was submitted. Withdraw or reopen to change it |
| Reopening | The reopened stage's approval is voided. Every later stage that was in progress, awaiting approval or completed becomes **blocked** with the reason; an open request there is withdrawn and an approval there is voided. Checklists, evidence and history are kept. Those stages resume once the reopened stage is completed again and then need a new approval | “Invalidate later approvals; do not delete later work; mark dependent stages for review / blocked and explain why” |
| Skipping | A reason is mandatory. Skipping a required stage is owner-only; an editor may skip an optional stage. A skipped stage counts as done for order and progress | The brief counts a skipped stage “with an approved reason”; the owner is the approving authority |
| Optional stage | An optional stage can start once the project has reached the required stage before it, and is never counted in progress or required for completing the lifecycle | Improve & Retire must not hold Operate back |
| Waivers | A waived item satisfies the checklist only with a recorded reason, stays visible as waived, and is audited with the reason | Brief §3.3 |
| Required items | Whether an item is required is fixed when it is created. Template items and required items cannot be deleted; only optional items added to the project can | A required item must not be silently dropped |
| Template edits | Saving replaces the template's definitions and bumps its version. In-use templates stay editable because projects hold snapshots; a template in use cannot be deleted (`restrict`). Editing or deactivating the workspace default is owner-only, and the default cannot be deactivated until another template is the default | Brief §7.8 and §9 |
| Lifecycle status | Stored statuses are active, on hold, completed and archived. “Not started” is shown for a project with no lifecycle row and is never stored. Completion is a manual step, allowed once every required stage is done. Stage changes need an active lifecycle | A project may stay in Operate indefinitely; completing the lifecycle is a decision |
| Due dates | No due date is generated from the template's typical duration; the duration is shown as guidance next to the due-date field | Invented dates would produce false overdue flags |
| Stage in the address | `/lifecycle` redirects to `/lifecycle?stage=<current>` so the view stays on a stage after an action, and every stage has a stable link | Brief §7.6 |
| Project root | `/projects/:id` is the overview. Requirements & Finder moved to `/projects/:id/requirements`; old `?run=` links are redirected | Brief §7.5 |
| Milestones and risks | One page with two sections; `/projects/:id/risks` redirects to it | Fewer tabs; both are short lists |

## Additions to the suggested data model

| Table | Added | Purpose |
|---|---|---|
| `project_lifecycles` | `template_name` | Snapshot of the template name for display |
| `project_stage_instances` | `default_duration_days`, `notes`, `skip_reason` | Duration guidance snapshot; working notes; the mandatory skip reason |
| `project_checklist_items` | `origin`, `status_changed_by`, `status_changed_at` | Template or project item; who last changed the status and when |
| `stage_approvals` | `invalidated_at`, `invalidated_reason` | Void an approved gate on reopen without rewriting history |
| `stage_evidence` | `superseded_at`, `superseded_by`, `superseded_reason` | The auditable way to retire a wrong reference |
| `project_risks` | check constraints on `likelihood` and `impact` | 1–5 enforced by the database as well as the service |

Severity and progress are not stored anywhere.

## Changes to existing behaviour

- The new-project form and the Finder's project list now open `/projects/:id/requirements`; the Finder returns there after a run.
- Sidebar: “Projects” and “Lifecycle Templates” were added (17 entries); the delivery group is now “Project Delivery” and includes the Architecture Finder.
- `tests/e2e/flow.spec.ts` was updated in three places to follow these intended changes: the navigation count (15 → 17), the address after creating a project, and the accessibility list (the requirements page was added so it stays covered). No assertion was removed.
- Fixed while extending the code: correlated subqueries in `listProjects` and `projectStats` bound to the inner table, so requirement counts, blueprint status and the “Approved blueprints” figure always read zero. A regression assertion was added.
- Fixed while testing narrow screens: a `fieldset` and scrollable tables could widen the page on phones (the requirements page was affected).

## Acceptance checklist

| Criterion | Evidence |
|---|---|
| One default template and custom templates per workspace | integration “creates custom templates, enforces unique names, roles and the single default”; e2e “a custom template can be created and edited…” |
| Default template has the eight stages | unit “default lifecycle template”; integration “provisions the default template once…” |
| Start a lifecycle on an existing project without touching its data | integration “initializes from the default template…” |
| Idempotent start with snapshots | integration “never gives a project a second lifecycle…”, “keeps a project's snapshots when its template is edited later” |
| Projects without a lifecycle show a not-started state | integration “leaves a project without a lifecycle readable…”; e2e “creates a project that has no lifecycle until one is started” |
| Owners and reviewers are workspace members | integration “assigns owners, reviewers and due dates to workspace members only” |
| Due dates, notes, blocked reasons, statuses | integration “lets a workspace owner decide any gate, and blocks and resumes…”; e2e “assigns an owner…”, “blocking a stage…” |
| Gates report blockers and are enforced on the server | unit “readiness evaluator”; integration “blocks the gate…”, “holds Discover…”, “holds Design…”, “holds Release…”; e2e gate tests |
| Required items cannot be skipped silently or deleted | integration “records who completed and reopened checklist items, and requires a reason to waive” |
| Evidence: artifacts, safe URLs, notes | unit “evidence references”; integration “links evidence only to this project's artifacts…”; e2e “attaches a safe link…” |
| Approval history kept; only reviewer or owner decides | integration “runs the approval gate…” |
| Reopen with reason and audit trail | integration “reopens a stage with a reason…”, “withdraws a pending request downstream…”; e2e “reopening a completed stage…” |
| Milestones and risks | integration “manages milestones…”, “keeps a risk register…”; e2e “records a milestone and a risk…” |
| Progress derived, not editable | unit “progress”; no progress column exists |
| Mission Control and portfolio show stored data | integration “reports the portfolio and Mission Control figures…”; e2e “shows the stage, progress, overdue state and risk count…” |
| Existing flows still work | the existing integration and e2e suites |
| Workspace scope and roles on every service | integration “gives viewers read access and nothing else” (17 calls), “denies every cross-workspace read and write as not found” (51 calls); e2e viewer and other-workspace tests |
| Mutating APIs use the wrapper and Zod | e2e “the lifecycle API validates input, hides unknown records and rejects cross-site writes” |
| Audit events | integration “appends audit events…” |
| No overflow at 820 and 390 px; no serious axe violations | e2e “lifecycle pages fit tablet and phone widths”, “lifecycle pages have no serious or critical axe violations…” |

## Not built in this phase

- Checklist items are never completed automatically from a source record. The three record-based conditions are gate rules, shown under Gate readiness; the matching checklist items (“Requirements approved in DataBrain”, “Blueprint approved in DataBrain”) are still ticked by a person.
- Moving a running lifecycle to another template or a newer template version.
- Member invitation and management screens; notifications and reminders; separation of duties between requester and approver.
- File upload for evidence.
- Everything listed as out of scope in the brief: catalog, lineage, connectors, data contracts, quality and test execution, monitoring, FinOps, new agents, new deployment adapters.

## Next steps

1. Member management, so reviewers other than the workspace creator can be added without the command line.
2. Phase 2 of the roadmap: data products and assets, linked to lifecycle stages through the existing evidence table.
3. Optional: reminders for overdue stages and milestones once a job queue exists.
