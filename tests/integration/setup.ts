import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://databrain:databrain@localhost:5432/databrain_test";
process.env.STORAGE_LOCAL_DIR = ".data/test-storage";

/** Empty the test database, migrate it and return two isolated workspaces, the first with the demo knowledge. */
export async function freshDatabase() {
  const { getDb } = await import("@/server/db");
  const { ensureWorkspace, seedKnowledge } = await import("@/server/seed/run");
  const db = getDb();
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: "./drizzle" });
  const alice = await ensureWorkspace({ email: "alice@example.test", name: "Alice", workspaceName: "Workspace A", isDemo: false });
  const bob = await ensureWorkspace({ email: "bob@example.test", name: "Bob", workspaceName: "Workspace B", isDemo: false });
  await seedKnowledge(alice);
  return { alice, bob };
}
