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

- Demo knowledge is unreviewed. Every seeded item is a draft; nothing should be relied on until verified.
- Requirement extraction is vocabulary matching. It misses anything phrased outside its vocabulary (reported as unknown) and can misread unusual sentences; the review step is the control.
- The in-process job runner loses a running job on restart (reported as failed, never as running forever). A multi-instance deployment needs a real queue.
- Rate limiting and login throttling are in-memory, per process.

## Next milestone

1. ~~A generative `LLMProvider`~~ — added: `AnthropicProvider` (extraction with a quote-grounding check, section drafting, cited answers). Still to do: run it against the real API and tune the prompts on real briefs.
2. A real `DeploymentAdapter` (Terraform plan/validate first), with credentials and scope agreed.
3. PDF export; pgvector-backed embeddings; a persistent job queue.
