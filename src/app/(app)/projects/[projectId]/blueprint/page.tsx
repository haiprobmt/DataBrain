import Link from "next/link";
import { Card, EmptyState, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { requireCtx } from "@/server/auth";
import { listDecisions, listRevisions, revisionIssues } from "@/server/services/blueprint";
import { providerStatus } from "@/server/providers";
import { BlueprintEditor } from "./blueprint-editor";
import { DecisionsPanel } from "./decisions-panel";

export const metadata = { title: "Solution Blueprint" };

export default async function BlueprintPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ revision?: string }> }) {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const wanted = (await searchParams).revision;
  const [revisions, decisions] = await Promise.all([listRevisions(ctx, projectId), listDecisions(ctx, projectId)]);
  if (revisions.length === 0) {
    return (
      <Card>
        <EmptyState title="No blueprint yet" action={<Link className="btn primary" href={`/projects/${projectId}/requirements#candidates`}>Go to the Architecture Finder</Link>}>
          A blueprint starts from a candidate. Approve the requirements, run the Finder, then choose “Create blueprint from this” on the candidate you want to develop.
        </EmptyState>
      </Card>
    );
  }
  const revision = revisions.find((r) => r.id === wanted) ?? revisions[0]!;
  const readOnly = ctx.role === "viewer";
  const llm = providerStatus().find((p) => p.kind === "LLM");
  const aiModel = llm?.available && llm.configured !== "local" ? llm.active : null;

  return (
    <div className="stack">
      <Card title="Revisions" aside={<span className="muted">Approved revisions are immutable. Changes go into a new revision.</span>}>
        <div className="actions">
          {revisions.map((r) => (
            <Link key={r.id} href={`?revision=${r.id}`} className="option" style={{ width: "auto", minWidth: 170 }} aria-current={r.id === revision.id ? "page" : undefined}>
              <strong>Version {r.version}</strong> <StatusBadge status={r.status} />
              <div className="muted">{r.status === "approved" || r.status === "superseded" ? `Approved ${formatDate(r.approvedAt)}` : `Edited ${formatDate(r.updatedAt)}`}</div>
            </Link>
          ))}
        </div>
      </Card>
      <BlueprintEditor
        key={`${revision.id}:${revision.lockVersion}`}
        projectId={projectId}
        readOnly={readOnly}
        canApprove={ctx.role === "owner"}
        aiModel={aiModel}
        issues={revisionIssues(revision)}
        revision={{ id: revision.id, version: revision.version, status: revision.status, title: revision.title, label: revision.label, sections: revision.sections, diagram: revision.diagram, lockVersion: revision.lockVersion, contentHash: revision.contentHash, approvalNote: revision.approvalNote, approvedAt: revision.approvedAt ? revision.approvedAt.toISOString() : null }}
      />
      <Card title="Architecture decision records" id="decisions">
        <DecisionsPanel
          projectId={projectId}
          revisionId={revision.id}
          readOnly={readOnly}
          decisions={decisions.map((d) => ({ id: d.id, number: d.number, title: d.title, status: d.status, context: d.context, decision: d.decision, alternatives: d.alternatives, consequences: d.consequences, revisionId: d.revisionId, locked: d.status === "accepted" && !!d.revisionId && revisions.find((r) => r.id === d.revisionId)?.status !== "draft" }))}
        />
      </Card>
    </div>
  );
}
