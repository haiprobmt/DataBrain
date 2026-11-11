import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { requireCtx } from "@/server/auth";
import { AppError } from "@/server/errors";
import { getLifecycleTemplate, listLifecycleTemplates } from "@/server/services/lifecycle-templates";
import { NewTemplateForm, TemplateActions } from "./template-actions";
import { TemplateEditor } from "./template-editor";

export const metadata = { title: "Lifecycle Templates" };

export default async function LifecycleTemplatesPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const ctx = await requireCtx();
  const wanted = (await searchParams).template;
  const templates = await listLifecycleTemplates(ctx);
  const selectedId = wanted ?? templates[0]!.id;
  const template = await getLifecycleTemplate(ctx, selectedId).catch((error) => {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  });
  const canEdit = ctx.role !== "viewer";
  const isOwner = ctx.role === "owner";
  // The workspace default can only be changed by an owner.
  const canEditThis = canEdit && (isOwner || !template.isDefault);

  return (
    <>
      <PageHeader title="Lifecycle Templates" description="The stages, checklists and gate conditions a project lifecycle starts from. A project copies its template when the lifecycle starts, so editing a template never changes a lifecycle that is already running." />
      <div className="gridtwo" style={{ ["--cols" as string]: "minmax(260px, 0.6fr) minmax(0, 1.6fr)" }}>
        <div className="stack">
          <Card title="Templates">
            <nav aria-label="Lifecycle templates" className="stack" style={{ gap: 8 }}>
              {templates.map((t) => (
                <Link key={t.id} href={`/lifecycle-templates?template=${t.id}`} className="option" aria-current={t.id === template.id ? "page" : undefined}>
                  <strong style={{ display: "block", color: "var(--navy)" }}>{t.name}</strong>
                  <span className="actions" style={{ marginTop: 6, gap: 6 }}>
                    {t.isDefault && <Badge tone="ok">Default</Badge>}
                    {!t.isActive && <StatusBadge status="archived" label="Deactivated" />}
                    {t.builtIn && <Badge>Built-in</Badge>}
                  </span>
                  <span className="muted" style={{ display: "block", marginTop: 6 }}>v{t.version} · {t.stageCount} stages · used by {t.projectCount} project{t.projectCount === 1 ? "" : "s"}</span>
                </Link>
              ))}
            </nav>
          </Card>
          {canEdit && (
            <Card title="New template">
              <NewTemplateForm templates={templates.map((t) => ({ id: t.id, name: t.name }))} selectedId={template.id} />
            </Card>
          )}
        </div>

        <div className="stack">
          <Card title={template.name} aside={<span className="actions">{template.isDefault && <Badge tone="ok">Workspace default</Badge>}<StatusBadge status={template.isActive ? "active" : "archived"} label={template.isActive ? "Active" : "Deactivated"} /></span>}>
            <dl className="kv">
              <dt>Version</dt><dd>{template.version}</dd>
              <dt>Origin</dt><dd>{template.builtIn ? "Built-in template provisioned by DataBrain" : "Created in this workspace"}</dd>
              <dt>Used by</dt><dd>{template.projectCount} project lifecycle{template.projectCount === 1 ? "" : "s"}{template.projectCount > 0 ? " — each holds its own snapshot and is not changed by edits here" : ""}</dd>
              <dt>Last changed</dt><dd>{formatDate(template.updatedAt)}</dd>
            </dl>
            {canEdit && <TemplateActions template={{ id: template.id, name: template.name, isDefault: template.isDefault, isActive: template.isActive }} isOwner={isOwner} />}
            {canEdit && !canEditThis && <p className="note warn" style={{ marginTop: 12 }}>This is the workspace default. Only a workspace owner can change it. You can create your own copy under “New template”.</p>}
            {!canEdit && <p className="note" style={{ marginTop: 12 }}>You have read-only access to lifecycle templates.</p>}
          </Card>
          <TemplateEditor key={`${template.id}-${template.version}`} template={template} readOnly={!canEditThis} />
        </div>
      </div>
    </>
  );
}
