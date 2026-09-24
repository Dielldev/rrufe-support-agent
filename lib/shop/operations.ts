/*
 * Operating settings that are not customer or policy data, so they don't live in
 * the database: the shop's display name and the service levels the support team
 * commits to when a message is handed over. Everything a reply states as *policy*
 * comes from the `policies` table instead (see lib/shop/policies.ts).
 */

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const OPS = {
  shopName: process.env.SHOP_NAME || "Rrufe Electronics",
  /** Reply time promised when an upset or repeat customer is handed to a person. */
  urgentSlaHours: numberFromEnv("SLA_URGENT_HOURS", 2),
  /** Reply time promised for every other handoff. */
  standardSlaHours: numberFromEnv("SLA_STANDARD_HOURS", 24),
  /** A parcel more than this many days past its expected date goes to a person instead of a trace. */
  lateHandoffDays: numberFromEnv("LATE_HANDOFF_DAYS", 5),
  /** Earlier contacts counted for the repeat-contact rule. */
  repeatWindowDays: numberFromEnv("REPEAT_WINDOW_DAYS", 14),
  /** Unanswered contacts within the window that make a customer a repeat contact. */
  repeatThreshold: numberFromEnv("REPEAT_THRESHOLD", 2),
};

/** Shop's calendar. Kosovo uses Central European time. */
export const SHOP_TIME_ZONE = "Europe/Belgrade";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Now" for the agent. `SHOP_TODAY=YYYY-MM-DD` pins the calendar date (the seed
 * data is written for 2026-09-24) while keeping the real time of day, so a demo
 * gives the same answers on any day.
 */
export function shopNow(real: Date = new Date()): Date {
  const pinned = process.env.SHOP_TODAY?.trim();
  if (!pinned || !ISO_DAY.test(pinned)) return real;
  return new Date(`${pinned}T${real.toISOString().slice(11)}`);
}
