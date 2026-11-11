import { AppError } from "./errors";

/** Request context. Services trust only this — never client-supplied user or workspace IDs. */
export interface Ctx {
  userId: string;
  userName: string;
  userEmail: string;
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "editor" | "viewer";
  isDemo: boolean;
  correlationId: string;
}

export function assertCanEdit(ctx: Ctx): void {
  if (ctx.role === "viewer") throw new AppError("forbidden", "Viewers cannot change data in this workspace.");
}
