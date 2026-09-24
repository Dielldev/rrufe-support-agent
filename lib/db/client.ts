import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type Client, type Config } from "@libsql/client";

/*
 * One libSQL client for the whole server. libSQL speaks plain SQLite, so the same
 * code runs against:
 *   - a local file (default: db/shop.db, built from db/schema.sql + db/seed.sql
 *     on first use), and
 *   - a hosted Turso database when DATABASE_URL=libsql://… is set (deployments).
 * On Vercel without DATABASE_URL, the file goes to /tmp: it works, but every cold
 * start begins again from the seed and each instance has its own copy.
 */

const DB_DIR = path.join(process.cwd(), "db");

export function databaseConfig(): Config & { kind: "remote" | "file" | "memory" | "ephemeral" } {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const kind = url === ":memory:" ? "memory" : url.startsWith("file:") ? "file" : "remote";
    return { url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined, kind };
  }
  if (process.env.VERCEL) return { url: "file:/tmp/rrufe-shop.db", kind: "ephemeral" };
  return { url: "file:db/shop.db", kind: "file" };
}

export async function readSql(name: "schema.sql" | "seed.sql"): Promise<string> {
  return readFile(path.join(DB_DIR, name), "utf8");
}

async function hasSchema(client: Client): Promise<boolean> {
  const r = await client.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'customers'");
  return r.rows.length > 0;
}

/** Create the tables and load the seed data. Only runs on an empty database. */
export async function ensureSeeded(client: Client): Promise<"existing" | "seeded"> {
  if (await hasSchema(client)) return "existing";
  await client.executeMultiple(await readSql("schema.sql"));
  await client.executeMultiple(await readSql("seed.sql"));
  return "seeded";
}

/** Drop everything and reload schema + seed. Used by the Settings page and `npm run db:reset`. */
export async function resetDatabase(client: Client): Promise<void> {
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%'",
  );
  const drops = tables.rows.map((r) => `DROP TABLE IF EXISTS "${String(r.name).replaceAll('"', '""')}";`).join("\n");
  await client.executeMultiple(`PRAGMA foreign_keys = OFF;\n${drops}\nPRAGMA foreign_keys = ON;`);
  await client.executeMultiple(await readSql("schema.sql"));
  await client.executeMultiple(await readSql("seed.sql"));
}

type Holder = { promise?: Promise<Client> };
// Survives Next.js dev hot reloads, so there is one connection per server process.
const holder: Holder = ((globalThis as { __rrufeDb?: Holder }).__rrufeDb ??= {});

async function open(): Promise<Client> {
  const { url, authToken } = databaseConfig();
  const client = createClient({ url, authToken });
  await client.execute("PRAGMA foreign_keys = ON");
  await ensureSeeded(client);
  return client;
}

export function db(): Promise<Client> {
  holder.promise ??= open().catch((err) => {
    holder.promise = undefined;
    throw err;
  });
  return holder.promise;
}

/** Tests (and scripts) can hand in their own client, e.g. an in-memory database. */
export function setDatabase(client: Client): void {
  holder.promise = Promise.resolve(client);
}
