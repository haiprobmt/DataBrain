import { Card } from "@/components/ui";
import { requireCtx } from "@/server/auth";
import { listRevisions } from "@/server/services/blueprint";
import { effectiveWeights, listCandidates } from "@/server/services/finder";
import { getItemsByIds } from "@/server/services/knowledge";
import { getProject, getRequirements } from "@/server/services/projects";
import { getDb, schema } from "@/server/db";
import { providerStatus } from "@/server/providers";
import { and, eq, inArray } from "drizzle-orm";
import { BriefForm } from "./brief-form";
import { FinderPanel } from "./finder-panel";
import { RequirementsEditor } from "./requirements-editor";

export const metadata = { title: "Requirements & Finder" };

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ run?: string }> }) {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const run = Number((await searchParams).run) || undefined;
  const [project, requirements, finder, weights, revisions] = await Promise.all([getProject(ctx, projectId), getRequirements(ctx, projectId), listCandidates(ctx, projectId, run), effectiveWeights(ctx, projectId), listRevisions(ctx, projectId)]);
  const relatedIds = [...new Set(finder.candidates.flatMap((c) => [...c.relatedItemIds, ...(c.scenarioId ? [c.scenarioId] : [])]))];
  const sourceIds = [...new Set(finder.candidates.flatMap((c) => c.sourceIds))];
  const [related, sources] = await Promise.all([
    getItemsByIds(ctx, relatedIds),
    sourceIds.length ? getDb().select().from(schema.sources).where(and(eq(schema.sources.workspaceId, ctx.workspaceId), inArray(schema.sources.id, sourceIds))) : [],
  ]);
  const readOnly = ctx.role === "viewer" || project.status === "archived";
  const llm = providerStatus().find((p) => p.kind === "LLM");
  const extractor = { generative: !!llm?.available && llm.configured !== "local", name: llm?.active ?? "unavailable", error: llm?.available ? null : (llm?.note ?? null) };

  return (
    <div className="stack">
      <Card title="Project brief">
        <BriefForm project={{ id: project.id, name: project.name, description: project.description, context: project.context, status: project.status }} hasRequirements={requirements.length > 0} readOnly={ctx.role === "viewer"} extractor={extractor} />
      </Card>
      <Card title="Requirements" id="requirements">
        <RequirementsEditor
          projectId={project.id}
          status={project.requirementsStatus}
          readOnly={readOnly}
          rows={requirements.map((r) => ({ field: r.field, state: r.state, value: r.value, kind: r.kind, origin: r.origin, evidence: r.evidence, confidence: r.confidence, tokens: r.tokens }))}
        />
      </Card>
      <Card title="Architecture candidates" id="candidates">
        <FinderPanel
          projectId={project.id}
          requirementsApproved={project.requirementsStatus === "approved"}
          readOnly={readOnly}
          weights={weights}
          run={finder.run}
          latestRun={finder.latestRun}
          ranAt={finder.ranAt ? finder.ranAt.toISOString() : null}
          excluded={finder.excluded}
          candidates={finder.candidates.map((c) => ({
            id: c.id, rank: c.rank, title: c.title, summary: c.summary, label: c.label, score: c.score, confidence: c.confidence, factors: c.factors, gaps: c.gaps, tradeoffs: c.tradeoffs,
            assumptions: c.assumptions, costDrivers: c.costDrivers, matchReasons: c.matchReasons, generator: c.generator, weights: c.weights,
            scenario: related.find((r) => r.id === c.scenarioId) ? { slug: related.find((r) => r.id === c.scenarioId)!.slug, status: related.find((r) => r.id === c.scenarioId)!.status, isDemo: related.find((r) => r.id === c.scenarioId)!.isDemo } : null,
            related: related.filter((r) => c.relatedItemIds.includes(r.id)).map((r) => ({ slug: r.slug, title: r.title, type: r.type, status: r.status })),
            sources: sources.filter((s) => c.sourceIds.includes(s.id)).map((s) => ({ id: s.id, title: s.title, url: s.url, sourceType: s.sourceType, lastVerifiedAt: s.lastVerifiedAt ? s.lastVerifiedAt.toISOString() : null, isDemo: s.isDemo })),
            revisionVersion: revisions.find((r) => r.candidateId === c.id)?.version ?? null,
          }))}
        />
      </Card>
    </div>
  );
}
