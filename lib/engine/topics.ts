import type { PolicyBook } from "@/lib/shop/policies";
import { rx } from "./text";
import type { Intent } from "./types";

/*
 * Topics a message can be about, beyond the core order paths. This is language
 * understanding (which words point at which topic), not shop data: whether the
 * shop has a policy for a topic is decided by the `policies` table at run time.
 */

export interface TopicInfo {
  id: string;
  label: string;
  /** Noun phrase for replies: "Paying in installments isn't something I can confirm…" */
  en: string;
  sq: string;
}

export interface TopicDetector extends TopicInfo {
  examples: string[];
  re: RegExp;
}

/** Topics recognised from keywords. Checked before the intent keywords. */
export const TOPIC_DETECTORS: TopicDetector[] = [
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
];

/** Topics that come from an intent rather than a keyword detector. */
const INTENT_TOPICS: Record<string, TopicInfo> = {
  store: { id: "store", label: "Store & opening hours", en: "our store address and opening hours", sq: "adresën dhe orarin e dyqanit" },
  payments: { id: "payments", label: "Payment methods", en: "payment methods", sq: "mënyrat e pagesës" },
};

/** Which policy topic has to exist before the agent may answer an intent. `null` = no policy needed. */
export const POLICY_FOR_INTENT: Record<Intent, string | null> = {
  order_status: "delivery",
  order_list: "privacy",
  // The catalog is shop data, not policy: any sender may ask about products.
  product_search: null,
  delivery_info: "delivery",
  return_request: "returns",
  order_change: "order_changes",
  product_fault: "warranty",
  personal_data_request: "privacy",
  store_info: "store",
  payment_methods: "payments",
  financing: "installments",
  small_talk: null,
  other: null,
};

export function topicInfo(id: string | undefined): TopicInfo | undefined {
  if (!id) return undefined;
  return TOPIC_DETECTORS.find((t) => t.id === id) ?? INTENT_TOPICS[id];
}

/** The policy topic a message needs, given its intent and any detected topic. */
export function requiredTopic(intent: Intent, detectedTopic: string | undefined): string | null {
  if (detectedTopic) return detectedTopic;
  return POLICY_FOR_INTENT[intent];
}

/** Detected topics with no policy row, for the Policies page. */
export function uncoveredTopics(book: PolicyBook): TopicInfo[] {
  const all: TopicInfo[] = [...TOPIC_DETECTORS, ...Object.values(INTENT_TOPICS)];
  return all.filter((t) => !book.topics.includes(t.id));
}
