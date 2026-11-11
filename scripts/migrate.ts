import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, getDb } from "../src/server/db";

async function main() {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
