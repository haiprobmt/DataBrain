import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, getDb } from "../src/server/db";
import { env } from "../src/server/env";

/** Drop everything and re-run the migrations. Refuses to run unless the database name ends in _test or --force is passed. */
async function main() {
  const name = new URL(env.databaseUrl).pathname.slice(1);
  if (!name.endsWith("_test") && !process.argv.includes("--force")) {
    console.error(`Refusing to reset database "${name}". Pass --force to confirm you want to delete all of its data.`);
    process.exit(1);
  }
  const db = getDb();
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log(`Database "${name}" reset and migrated.`);
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
