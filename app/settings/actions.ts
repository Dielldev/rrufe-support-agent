"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { databaseConfig, db, resetDatabase } from "@/lib/db/client";

/** Local and throwaway databases can be reset from the UI; a hosted one only with DB_ALLOW_RESET=1. */
export async function resetAllowed(): Promise<boolean> {
  if (process.env.DB_ALLOW_RESET === "0") return false;
  if (databaseConfig().kind === "remote") return process.env.DB_ALLOW_RESET === "1";
  return true;
}

/**
 * Toggle fallback mode. When disabled, template/regex drafts are blocked and pure AI is enforced.
 */
export async function setFallbackMode(allowed: boolean): Promise<void> {
  const jar = await cookies();
  if (allowed) {
    jar.set("rrufe_allow_fallback", "1", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  } else {
    jar.set("rrufe_allow_fallback", "0", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }
  revalidatePath("/", "layout");
}

/**
 * Put the database back to db/schema.sql + db/seed.sql. Reachable by direct POST
 * like any Server Function, so it re-checks the permission itself.
 */
export async function resetDemoData(): Promise<void> {
  if (!(await resetAllowed())) throw new Error("Resetting this database is disabled.");
  await resetDatabase(await db());
  revalidatePath("/", "layout");
}
