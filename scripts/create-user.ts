import { hashPassword } from "../src/server/crypto";
import { closeDb } from "../src/server/db";
import { ensureWorkspace } from "../src/server/seed/run";

/** Usage: npm run user:create -- <email> <name> <workspace name>   (password is read from DATABRAIN_NEW_PASSWORD) */
async function main() {
  const [email, name, workspaceName] = process.argv.slice(2);
  const password = process.env.DATABRAIN_NEW_PASSWORD;
  if (!email || !name || !workspaceName || !password || password.length < 12) {
    console.error('Usage: DATABRAIN_NEW_PASSWORD="<12+ characters>" npm run user:create -- <email> "<name>" "<workspace name>"');
    process.exit(1);
  }
  const ctx = await ensureWorkspace({ email: email.toLowerCase(), name, workspaceName, isDemo: false, passwordHash: hashPassword(password) });
  console.log(`User ${ctx.userEmail} is an owner of workspace “${ctx.workspaceName}”.`);
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
