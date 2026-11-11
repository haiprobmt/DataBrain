import type { Ctx } from "./ctx";
import { getDb, schema, type Tx } from "./db";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}

/** Append an audit event. Metadata must never contain secrets or full prompt payloads. */
export async function audit(ctx: Pick<Ctx, "userId" | "workspaceId" | "correlationId">, input: AuditInput, tx: Tx = getDb()): Promise<void> {
  await tx.insert(schema.auditEvents).values({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    projectId: input.projectId ?? null,
    summary: input.summary,
    metadata: input.metadata ?? {},
    correlationId: ctx.correlationId,
  });
}
