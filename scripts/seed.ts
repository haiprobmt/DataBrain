import { closeDb } from "../src/server/db";
import { seedDemo } from "../src/server/seed/run";

async function main() {
  const result = await seedDemo();
  console.log(`Demo workspace ready: ${result.items} knowledge item(s) added, ${result.refreshed} refreshed, ${result.sources} source(s), ${result.relationships} relationship(s) added.`);
  console.log("Every item is a draft. AI-researched items cite the pages they rely on; none has been reviewed by a person.");
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
