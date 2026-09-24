"use server";

import { revalidatePath } from "next/cache";
import { databaseConfig, db, resetDatabase } from "@/lib/db/client";

/** Local and throwaway databases can be reset from the UI; a hosted one only with DB_ALLOW_RESET=1. */
export async function resetAllowed(): Promise<boolean> {
  if (process.env.DB_ALLOW_RESET === "0") return false;
  if (databaseConfig().kind === "remote") return process.env.DB_ALLOW_RESET === "1";
  return true;
}

/**
 * Put the database back to db/schema.sql + db/seed.sql. Reachable by direct POST
 * like any Server Function, so it re-checks the permission itself; on a deployment
 * the whole site also sits behind DEMO_PASSWORD (proxy.ts).
 */
export async function resetDemoData(): Promise<void> {
  if (!(await resetAllowed())) throw new Error("Resetting this database is disabled.");
  await resetDatabase(await db());
  revalidatePath("/", "layout");
}
