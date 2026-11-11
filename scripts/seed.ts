import { closeDb } from "../src/server/db";
import { seedDemo } from "../src/server/seed/run";

async function main() {
  const result = await seedDemo();
  console.log(`Demo workspace ready: ${result.items} knowledge item(s), ${result.sources} source(s), ${result.relationships} relationship(s) added.`);
  console.log("All seed content is labelled as demo data and seeded as draft (unreviewed).");
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
