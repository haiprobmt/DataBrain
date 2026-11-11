import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0] | Db;

const globalForDb = globalThis as unknown as { __databrainPool?: Pool; __databrainDb?: Db };

export function getPool(): Pool {
  if (!globalForDb.__databrainPool) {
    globalForDb.__databrainPool = new Pool({ connectionString: env.databaseUrl, max: 10 });
  }
  return globalForDb.__databrainPool;
}

export function getDb(): Db {
  if (!globalForDb.__databrainDb) {
    globalForDb.__databrainDb = drizzle(getPool(), { schema });
  }
  return globalForDb.__databrainDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__databrainPool?.end();
  globalForDb.__databrainPool = undefined;
  globalForDb.__databrainDb = undefined;
}

export { schema };
