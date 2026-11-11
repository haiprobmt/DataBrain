import { eq } from "drizzle-orm";
import { hashPassword } from "../src/server/crypto";
import { closeDb, getDb, schema } from "../src/server/db";
import { env } from "../src/server/env";
import { ensureWorkspace } from "../src/server/seed/run";

/** Creates an account, or resets the password of an existing one. Usage: npm run user:create -- <email> <name> <workspace name>   (password is read from DATABRAIN_NEW_PASSWORD) */
async function main() {
  const [email, name, workspaceName] = process.argv.slice(2);
  const password = process.env.DATABRAIN_NEW_PASSWORD;
  if (!email || !name || !workspaceName || !password || password.length < 12) {
    console.error('Usage: DATABRAIN_NEW_PASSWORD="<12+ characters>" npm run user:create -- <email> "<name>" "<workspace name>"');
    process.exit(1);
  }
  const db = getDb();
  const address = email.toLowerCase();
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, address)).limit(1);
  const passwordHash = hashPassword(password);
  const ctx = await ensureWorkspace({ email: address, name, workspaceName, isDemo: false, passwordHash });
  // Running the command again for an existing account resets its password.
  if (existing) await db.update(schema.users).set({ passwordHash, name }).where(eq(schema.users.id, existing.id));
  const target = new URL(env.databaseUrl);
  console.log(`${existing ? "Password reset for" : "Created"} ${ctx.userEmail} (${ctx.role} of workspace “${ctx.workspaceName}”).`);
  console.log(`Database: ${target.hostname}:${target.port || 5432}${target.pathname} — the app must use the same DATABASE_URL.`);
  console.log(`Password length received: ${password.length} characters.`);
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
