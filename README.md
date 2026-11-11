# DataBrain by DataLabsIQ

A personal Data & AI Architecture Intelligence Platform. It keeps a knowledge base of scenarios, patterns and technologies, turns a project brief into ranked reference architectures with the reasons behind every score, and packages an approved blueprint into documents, IaC starters, agent skills and a gated deployment plan.

**Workflow:** project requirements → architecture candidates → approved blueprint → artifact package → agent skills → dry-run and approval → evidence.

## What works

| Module | What you can do |
|---|---|
| Mission Control | Project and knowledge counts, review queue, recent activity |
| Architecture Finder | Create a project, extract requirements from your text with the source sentence as evidence, mark each field known / unknown / not applicable, approve, rank scenarios on seven weighted factors, compare candidates, see what was filtered out and why |
| Solution Blueprint | 20 editable sections, an editable React Flow diagram (add, connect, edit, delete; Mermaid / draw.io / JSON export), decision records, validation, immutable approval, new revisions |
| Artifact Factory | 16 artifacts (HLD, LLD, ADRs, security design, runbook, diagrams, Terraform starter, CI pipeline, SQL scaffold, migration plan, test plan, cutover checklist), checks, version history and diff, hand-edit protection, manifest, ZIP and DOCX export |
| AI Skill Factory | Platform, pattern, scenario and validation skills with validated `SKILL.md`, dependencies, compatibility, package ZIP |
| Deployment Studio | Environments, hashed plan, dry-run, approval bound to plan hash + environment + expiry, evidence per check, run log |
| Knowledge | Library with search and review status, article pages with sources / relationships / versions, document import, graph explorer, scenario / pattern / migration / experience views, technology comparison |
| AI Workspace | Questions answered by quoting stored passages with citations |
| Settings | Providers, workspace settings, source register, audit log |

## Read this before relying on it

- **No generative AI is configured.** Requirement extraction is vocabulary and pattern matching over your own text. Artifacts and skills come from fixed templates. The AI Workspace quotes stored passages; it writes nothing.
- **The seeded knowledge is demo content.** It was written from general platform knowledge and has **not** been checked against the documentation pages it cites. Every item is seeded as a draft, flagged “Demo”, with no verification date.
- **Nothing is deployed.** The only deployment adapter is a simulator. It runs real read-only checks on the generated files (checksums, syntax, secret scan) and reports everything that needs a real platform as “not run”. An approved execution rehearses the approval flow and creates nothing.
- **Scores are decision aids.** No prices, SKUs, network ranges or tenant IDs are ever generated; those are marked `TODO` or `PLACEHOLDER`.

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

Open http://localhost:3000. In demo mode you are signed in as the seeded demo user. A sample project, “Demo: Retail analytics modernisation”, is ready for requirement extraction.

Without Docker, create the role and databases yourself: a `databrain` role with password `databrain`, owning databases `databrain` and `databrain_test`.

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
| `npm run test:unit` | 23 passed |
| `npm run test:integration` | 22 passed |
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
src/lib            Pure domain logic: scoring, diagram, vocabulary, validation, schemas
src/server         Database, auth, audit, jobs, providers, services, seed
drizzle            SQL migrations
tests              unit / integration / e2e
```

Every service function takes a request context and scopes its queries to that workspace; a record in another workspace is reported as not found. Provider interfaces (`LLMProvider`, `EmbeddingProvider`, `Reranker`, `DocumentExtractor`, `ObjectStorage`, `DeploymentAdapter`, `SourceConnector`) are in `src/server/providers/types.ts`. Naming a provider that has no implementation is a configuration error — the app does not fall back to a local stand-in.

Security controls in place: signed HTTP-only session cookie, scrypt password hashes, role checks (owner / editor / viewer), same-origin check on state-changing requests, 2 MB body limit, per-user rate limit, login throttling, Zod validation at every API boundary, secret scan on generated files, redaction of evidence output, audit events for create / update / approve / export / deploy.

## Known limitations

- PDF export is not built (Markdown and DOCX are).
- Only `.md` and `.txt` documents can be imported.
- Jobs run in-process: a job running when the server restarts is reported as failed and must be started again.
- Rate limits are per process and in memory.
- No backup/restore tooling or metrics endpoint beyond `/api/health`.
- The diagram canvas and graph canvas are mouse-driven; each has a table/list alternative for keyboard use.

See `docs/IMPLEMENTATION-PLAN.md` for decisions, deviations from the build skills, the acceptance checklist and the next milestone.
