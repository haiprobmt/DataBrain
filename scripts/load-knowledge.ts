import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, getDb, schema } from "../src/server/db";
import { seedKnowledge } from "../src/server/seed/run";

/** Usage: npm run knowledge:load -- <email>   Loads the starter knowledge library into that user's workspace. */
async function main() {
  const email = process.argv[2]?.toLowerCase();
  if (!email) {
    console.error("Usage: npm run knowledge:load -- <email of an existing account>");
    process.exit(1);
  }
  const db = getDb();
  const [row] = await db
    .select({ user: schema.users, workspace: schema.workspaces, role: schema.memberships.role })
    .from(schema.users)
    .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.users.id))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(eq(schema.users.email, email))
    .limit(1);
  if (!row) {
    console.error(`No account with email ${email} in this database. Create it first with user:create.`);
    process.exit(1);
  }
  if (row.role === "viewer") {
    console.error(`${email} is a viewer of “${row.workspace.name}” and cannot add knowledge.`);
    process.exit(1);
  }
  const result = await seedKnowledge({ userId: row.user.id, userName: row.user.name, userEmail: row.user.email, workspaceId: row.workspace.id, workspaceName: row.workspace.name, role: row.role, isDemo: row.workspace.isDemo, correlationId: randomUUID() });
  console.log(`Workspace “${row.workspace.name}”: ${result.items} item(s) added, ${result.refreshed} refreshed, ${result.kept} left alone because you changed or reviewed them.`);
  console.log(`${result.sources} source(s) and ${result.relationships} relationship(s) added. Every item is a draft until you review it.`);
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
