import { rx } from "@/lib/engine/text";

/** Fictional shop used for the demo. All data is in-memory mock data. */
export const SHOP = {
  name: "Rrufe Electronics",
  city: "Prishtinë",
  address: "Rr. Fehmi Agani 21, Prishtinë",
  phone: "+383 38 600 700",
  email: "support@rrufe.example",
  hours: {
    en: "Mon–Sat 09:00–20:00, Sun 10:00–16:00",
    sq: "e hënë–e shtunë 09:00–20:00, e diel 10:00–16:00",
  },
} as const;

/** The written policy. If a question is not answered here, the agent does not answer it. */
export const POLICY = {
  delivery: {
    windowMinDays: 2,
    windowMaxDays: 4,
    /** Past this many days since ordering, a late parcel is a human decision. */
    humanAfterDays: 10,
    fee: 2.5,
    freeOver: 50,
    traceUpdateHours: 24,
  },
  returns: { windowDays: 30, unopenedOnly: true, refundBusinessDays: 5 },
  warranty: { months: 24, diagnostics: "3–5" },
  escalation: { urgentSlaHours: 2, standardSlaHours: 24 },
} as const;

export interface PolicyEntry {
  id: string;
  title: string;
  summary: string;
}

export const POLICY_CATALOG: PolicyEntry[] = [
  {
    id: "delivery",
    title: "Delivery",
    summary: "2–4 days across Kosovo · €2.50, free over €50 · late → carrier trace · over 10 days → human",
  },
  {
    id: "returns",
    title: "Returns",
    summary: "Within 30 days of delivery · unopened, factory seal intact · refund in 5 business days",
  },
  { id: "warranty", title: "Warranty", summary: "24 months on all electronics · free courier pickup for diagnostics" },
  { id: "privacy", title: "Privacy", summary: "Address, phone and email go only to the verified buyer" },
  { id: "payments", title: "Payment methods", summary: "Card, cash on delivery, bank transfer — paid up front" },
  { id: "store", title: "Store & hours", summary: `${SHOP.address} · ${SHOP.hours.en}` },
];

/**
 * Topics customers ask about that the shop has NO written policy for.
 * A match here always escalates — the agent never improvises an answer.
 */
export const UNCOVERED_TOPICS = [
  {
    id: "installments",
    label: "Installments / financing",
    en: "paying in installments",
    sq: "blerjen me këste",
    examples: ["këste", "installments", "pay monthly", "me kredi"],
    re: rx(
      String.raw`\b(k[eë]st\w*|installments?|instalments?|monthly payments?|pay (?:it )?(?:monthly|in parts|over time|later)|financ\w*|leasing|on credit|me kredi|kredi (?:bankare|pa interes)|buy now,? pay later|bnpl|pagesa mujore|pages[eë] mujore|me muaj|paguaj\w* (?:me|n[eë]) (?:pjes[eë]|muaj))\b`,
    ),
  },
  {
    id: "trade_in",
    label: "Trade-in",
    en: "trade-ins",
    sq: "ndërrimin e pajisjes së vjetër",
    examples: ["trade-in", "exchange my old"],
    re: rx(String.raw`\b(trade[- ]?in|exchange my old|nd[eë]rrim\w* (?:me|t[eë]) (?:vjet[eë]r|vjetrin)|me t[eë] vjetrin)\b`),
  },
  {
    id: "price_match",
    label: "Price matching",
    en: "price matching",
    sq: "barazimin e çmimit me dyqane të tjera",
    examples: ["price match", "cheaper elsewhere", "më lirë diku"],
    re: rx(String.raw`\b(price match\w*|match (?:the|a|their) price|cheaper (?:at|elsewhere|online)|m[eë] lir[eë] (?:diku|te|n[eë]))\b`),
  },
  {
    id: "business",
    label: "Business / bulk orders",
    en: "business and bulk orders",
    sq: "porositë për biznese dhe me shumicë",
    examples: ["bulk", "wholesale", "faturë për biznes"],
    re: rx(String.raw`\b(bulk|wholesale|b2b|company invoice|vat invoice|fak?tur\w* (?:p[eë]r|me) (?:biznes|kompani|tvsh)|shumic\w*)\b`),
  },
] as const;

export type UncoveredTopic = (typeof UNCOVERED_TOPICS)[number];
