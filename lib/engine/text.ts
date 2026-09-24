import type { Language } from "./types";

// JS `\b` and `\w` are ASCII-only, which breaks on Albanian words ending in ë/ç
// ("ditë.", "këste?"). `rx` rewrites them to Unicode-aware equivalents.
const WORD = "[\\p{L}\\p{N}_]";
const BOUNDARY = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`;

export function rx(source: string, flags = "i"): RegExp {
  const src = source.replace(/\\b/g, BOUNDARY).replace(/\\w/g, WORD);
  return new RegExp(src, flags.includes("u") ? flags : `${flags}u`);
}

export function normalize(text: string): string {
  return text
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, "-");
}

export function tokens(text: string): string[] {
  return (normalize(text).toLowerCase().match(/[\p{L}']+/gu) ?? [])
    .map((t) => t.replace(/^'+|'+$/g, "").replace(/'s$/, ""))
    .filter(Boolean);
}

const SQ_WORDS = new Set([
  "është", "eshte", "nuk", "s'ka", "ska", "për", "dhe", "ka", "kanë", "kane", "porosia",
  "porosinë", "porosine", "porosi", "ende", "mund", "ta", "blej", "këste", "keste", "ditë",
  "dite", "ditësh", "ditesh", "faleminderit", "përshëndetje", "pershendetje", "një", "nje",
  "ju", "jam", "të", "në", "çfarë", "cfare", "ku", "kur", "sa", "po", "jo", "ardhur",
  "kaluar", "kthej", "laptopin", "telefonin", "kufjet", "kufje", "adresa", "vëllai",
  "vellai", "motra", "herën", "heren", "askush", "prishur", "dua", "mundem", "juaj",
  "ime", "im", "tij", "saj", "keni", "kemi", "pse", "si", "edhe", "apo", "mirë", "mire",
  "ose", "pra", "sepse", "këtë", "kete", "tuaj", "blerë", "blere", "paguaj", "sot",
  "nesër", "neser", "porosinë", "dyqani", "dyqanit", "ne", "na", "më", "do", "qe", "që",
  "kutia", "hapur", "garanci", "garancia", "adresën", "ditëve", "orësh", "mundeni", "tungjatjeta", "mirëdita",
  "miredita", "mirëmbrëma", "gjej", "flm", "rregull", "ckemi", "çkemi", "gjendje",
]);

const EN_WORDS = new Set([
  "the", "is", "are", "can", "could", "my", "what", "after", "here", "time", "nobody",
  "answers", "i", "you", "your", "order", "return", "broken", "where", "when", "how",
  "please", "address", "brother", "box", "open", "days", "writing", "hasn't", "arrived",
  "still", "this", "that", "with", "for", "of", "it", "and", "do", "does", "have", "has",
  "not", "no", "yes", "hi", "hello", "thanks", "thank", "we", "will", "would", "be",
  "been", "was", "to", "in", "on", "at", "headphones", "anyone", "help", "which", "who",
  "sorry", "our", "us", "there", "they", "them", "if", "or", "but", "so", "just",
]);

/** Deterministic language guess. Albanian diacritics weigh extra. */
export function detectLanguage(text: string): Language {
  const toks = tokens(text);
  let sq = 0;
  let en = 0;
  for (const t of toks) {
    if (SQ_WORDS.has(t)) sq += 1;
    if (EN_WORDS.has(t)) en += 1;
  }
  sq += (text.match(/[ëçËÇ]/g) ?? []).length * 0.5;
  if (en > sq) return "en";
  return "sq";
}

export function normPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-8);
}

export function normEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 2)}•••@${domain}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ••• ${digits.slice(-3)}`;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---- calendar ----------------------------------------------------------------
// The database stores dates as 'YYYY-MM-DD' and timestamps as 'YYYY-MM-DD HH:MM:SS'
// (UTC). Day arithmetic runs on UTC midnights so a "day" is always 24h.

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' → UTC midnight. */
export function parseDay(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

/** 'YYYY-MM-DD HH:MM:SS' (UTC) → Date. */
export function parseTimestamp(ts: string): Date {
  return new Date(`${ts.trim().replace(" ", "T")}${/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? "" : "Z"}`);
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function sqlTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** The calendar day it is in `timeZone` at instant `now`, as a UTC midnight. */
export function calendarDay(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parseDay(parts);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** Adds Monday–Friday days, the way the seed computes shipment windows. */
export function addWorkingDays(d: Date, days: number): Date {
  let out = d;
  let left = days;
  while (left > 0) {
    out = addDays(out, 1);
    const wd = out.getUTCDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return out;
}

const MONTHS: Record<Language, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  sq: ["janar", "shkurt", "mars", "prill", "maj", "qershor", "korrik", "gusht", "shtator", "tetor", "nëntor", "dhjetor"],
};

/** "22 Sep" / "22 shtator". */
export function formatDay(d: Date, lang: Language = "en"): string {
  return `${d.getUTCDate()} ${MONTHS[lang][d.getUTCMonth()]}`;
}
