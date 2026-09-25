// Create (setup) or rebuild (reset) the shop database from db/schema.sql + db/seed.sql.
// Uses DATABASE_URL / DATABASE_AUTH_TOKEN when set (e.g. Turso), else db/shop.db.
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const mode = process.argv[2] ?? "setup";
const url = process.env.DATABASE_URL || "file:db/shop.db";
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
const sql = (f) => readFileSync(new URL(`../db/${f}`, import.meta.url), "utf8");

const exists = (await client.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='customers'")).rows.length > 0;
if (mode === "reset" && exists) {
  const t = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  await client.executeMultiple(`PRAGMA foreign_keys=OFF;\n${t.rows.map((r) => `DROP TABLE IF EXISTS "${r.name}";`).join("\n")}\nPRAGMA foreign_keys=ON;`);
}
if (mode === "reset" || !exists) {
  await client.executeMultiple(sql("schema.sql"));
  await client.executeMultiple(sql("seed.sql"));
  await client.executeMultiple(sql("extensions.sql"));
  const version = Number(readFileSync(new URL("../lib/db/client.ts", import.meta.url), "utf8").match(/const SCHEMA_VERSION = (\d+);/)?.[1] ?? 1);
  await client.execute(`PRAGMA user_version = ${version}`);
  console.log(`Loaded schema + seed into ${url.replace(/\/\/.*@/, "//")}`);
} else {
  console.log(`${url} already has data — use npm run db:reset to rebuild it.`);
}
client.close();
