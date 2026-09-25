import { covers, type PolicyBook } from "@/lib/shop/policies";
import { detectLanguage, normalize, rx } from "./text";
import { TOPIC_DETECTORS } from "./topics";
import type { Detection, Intent, OrderChangeKind, PiiField, ProductCategory, Signals } from "./types";

/*
 * Deterministic reading of the message. No model involved: every signal here
 * comes with the exact evidence (substring / rule) that triggered it.
 */

const ORDER_HASH = /#\s?(\d{3,6})(?!\d)/g;
const ORDER_WORD = rx(
  String.raw`\b(?:order|porosi\w*|nr\.?|no\.?)\s*(?:#|nr\.?|no\.?|number|num[eë]r|numri)?\s*(\d{3,6})\b`,
  "gi",
);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+|00)?383[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{3}|(?<!\d)0\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?!\d)/g;

const PRODUCTS: { category: ProductCategory; re: RegExp }[] = [
  { category: "headphones", re: rx(String.raw`\b(headphones?|earbuds?|headset|airpods|kufje\w*|slusha\w*)\b`) },
  { category: "laptop", re: rx(String.raw`\b(laptop\w*|notebook|macbook|ideapad|vivobook|pavilion|kompjuter\w*)\b`) },
  { category: "charger", re: rx(String.raw`\b(charger\w*|charging (?:brick|adapter)|karikues\w*|ngarkues\w*|adapter\w*)\b`) },
  {
    category: "phone",
    re: rx(String.raw`\b(smartphone|iphone|galaxy|redmi|xiaomi|mobile phone|celular\w*|telefon(?:in|i)? (?:i ri|celular)|my phone (?:is|won'?t|doesn'?t|stopped))\b`),
  },
];

const DAYS = rx(String.raw`\b(\d{1,3})\s*(days?|dit[eë]\w*)`, "gi");
const WEEKS = rx(String.raw`\b(\d{1,2})\s*(weeks?|jav[eë]\w*)`, "gi");

const SEALED = rx(
  String.raw`\b(unopened|sealed|never opened|not opened|still (?:in the box|wrapped)|e pahapur|i pahapur|t[eë] pahapura|pa e hapur|nuk e kam hapur|me vul[eë])\b`,
);
const OPENED = rx(
  String.raw`\b(box is open|box's open|opened|open box|box open|unsealed|used (?:it|them)|e hapur|i hapur|t[eë] hapura|e kam hapur|e hapa|kutia (?:[eë]sht[eë] )?(?:e )?hapur|p[eë]rdorur)\b`,
);

// ---- frustration / repeat --------------------------------------------------

const HOSTILE = rx(
  String.raw`\b(pissed(?: off)?|sick (?:and tired )?of|so annoyed|really annoyed|ridiculous|unacceptable|scam|worst|terrible|disgusting|furious|angry|fed up|useless|incompetent|pathetic|never again|lawyer|sue you|shame on you|mashtrim\w*|mashtrues\w*|turp\w*|skandal\w*|papranueshm\w*|qesharak\w*|budalla\w*|nervozuar|jam i m[eë]rzitur|jam e m[eë]rzitur)\b`,
);
const ACRONYMS = new Set(["HDMI", "OLED", "QLED", "WIFI", "USB", "SSD", "RAM", "JBL", "PS5", "VAT", "TVSH"]);

const ORDINAL_TIME = rx(String.raw`\b(\d+)(?:st|nd|rd|th)\s+time\b`);
const WORD_ORDINAL_TIME = rx(String.raw`\b(second|third|fourth|fifth|sixth|tenth)\s+time\b`);
const REPEAT_EN = rx(
  String.raw`\b(writing again|asking again|messaging again|contacting you again|once again|again and again|still (?:no (?:answer|reply|response)|waiting for (?:an? )?(?:answer|reply|response)|haven'?t heard)|already (?:wrote|written|sent|asked|called|messaged|contacted|told)|no ?one (?:answers|replies|responds|is answering|answered|replied|got back)|nobody (?:answers|replies|responds|is answering|answered|replied|got back)|no (?:answer|reply|response) (?:yet|from you|so far)|keep (?:writing|asking|calling|messaging)|how many times|(?:written|wrote) (?:to you )?(?:before|twice|several times|multiple times))\b`,
);
const REPEAT_SQ = rx(
  String.raw`\b(her[eë]n e (?:dyt[eë]|tret[eë]|kat[eë]rt|pest[eë]|\d+)|(?:shkruaj|pyes|kontaktoj|telefonoj|d[eë]rgoj)\w* (?:p[eë]rs[eë]ri|s[eë]rish|prap[eë])|(?:p[eë]rs[eë]ri|s[eë]rish|prap[eë]) (?:po )?(?:ju )?(?:shkruaj|pyes|kontaktoj)|disa her[eë]|sa her[eë]|askush (?:nuk |s'?)?(?:po )?(?:m[eë] )?(?:p[eë]rgjigj\w*|kthen p[eë]rgjigje)|ende (?:s'|nuk )(?:m[eë] )?(?:keni |ka |kan[eë] )?(?:kthyer p[eë]rgjigje|p[eë]rgjigjur|u p[eë]rgjigj\w*))`,
);

// ---- third party -----------------------------------------------------------

const REL_EN =
  "(brother|sister|wife|husband|mother|mom|mum|father|dad|son|daughter|friend|cousin|colleague|coworker|partner|uncle|aunt|neighbou?r|assistant|boss|girlfriend|boyfriend)";
const THIRD_EN_NAMED = rx(String.raw`\b([\p{L}]+)'s\s+${REL_EN}\b`);
const THIRD_EN = rx(
  String.raw`\b(on behalf of|for my ${REL_EN}|asking for (?:my )?${REL_EN}|i'?m (?:his|her|their) ${REL_EN}|i am (?:his|her|their) ${REL_EN}|my ${REL_EN}'?s? (?:order|package|parcel|purchase|address))\b`,
);
const REL_SQ =
  "(v[eë]llai|motra|gruaja|bashk[eë]shortja|bashk[eë]shorti|burri|n[eë]na|babai|djali|vajza|shoku|shoqja|kush[eë]riri|kush[eë]rira|kolegu|kolegia|daja|xhaxhai|tezja|halla)";
const THIRD_SQ = rx(
  String.raw`\b(jam\s+${REL_SQ}|${REL_SQ}\s+(?:i|e)\s+[\p{L}]+|n[eë] em[eë]r t[eë]|p[eë]r (?:v[eë]llain|motr[eë]n|grua?n|burrin|n[eë]n[eë]n|babain|djalin|vajz[eë]n|shokun|shoqen))\b`,
);

// ---- personal data ---------------------------------------------------------

const PII_FIELDS: Record<PiiField, RegExp> = {
  address: rx(
    String.raw`\b(address|adres\w*|where (?:does|do) (?:he|she|they) live|ku jeton|ku banon|delivery location|shipping location)\b`,
  ),
  phone: rx(
    String.raw`\b(phone number|phone no|mobile number|contact number|(?:his|her|their) phone|numr\w* (?:e |i )?(?:telefonit|celularit)|numri i (?:tij|saj)|telefon\w* (?:i|e) (?:tij|saj))\b`,
  ),
  email: rx(String.raw`\b(e-?mail\w*|imejl\w*)\b`),
};
const SELF_STATEMENT = rx(
  String.raw`\b(?:my|the)\s+(?:e-?mail|phone(?: number)?|number)\s+(?:is|:)\s*\S+|\b(?:e-?mail(?:i)?|numri|telefoni)\s+(?:im|imi|ime|jon[eë])\s*(?:[eë]sht[eë]|:)?\s*\S+`,
  "gi",
);
const SHOP_CONTEXT = rx(
  String.raw`\b(?:your|the)\s+(?:shop|store|office)(?:'s)?\s+(?:address|phone|number|e-?mail)|\b(?:address|phone|number|e-?mail)\s+(?:of|for)\s+(?:your|the)\s+(?:shop|store)|adres[aeë]\w* e dyqanit|ku ndodhet dyqani|numri i dyqanit`,
);
const ASKING = rx(
  String.raw`\b(what'?s|what is|what are|which|where|send me|give me|tell me|share|confirm|need|can you (?:tell|give|send|share|check)|cila|cili|cilat|[çc]far[eë]|ku|m[eë] trego|m[eë] jep|m[eë] d[eë]rgo|dua|a mund)\b`,
);
const PERSONAL_CONTEXT = rx(
  String.raw`\b(his|her|their|my|customer'?s?|buyer'?s?|on (?:the |my |this |that )?order|e tij|e saj|e porosis[eë]|n[eë] porosi)\b`,
);

const ORDER_CHANGE_RX: [OrderChangeKind, RegExp][] = [
  [
    "address",
    rx(
      String.raw`\b((?:change|update|correct|edit|fix|modify|switch)\w*\s+(?:\w+\s+){0,3}?address|wrong (?:delivery |shipping )?address|new (?:delivery |shipping )?address|(?:deliver|send|ship)\w*\s+(?:it\s+|them\s+|the order\s+)?to\s+(?:a\s+|my\s+)?(?:different|new|another|other)\s+address|(?:ndrysho|nd[eë]rro|korrigjo|p[eë]rdit[eë]so)\w*\s+(?:\w+\s+){0,3}?adres\w*|adres\w*\s+(?:e\s+|t[eë]\s+)?(?:re|gabuar|tjet[eë]r))\b`,
    ),
  ],
  [
    "remove_item",
    rx(
      String.raw`\b((?:remove|take\s+(?:off|out)|drop|delete)\s+(?:\w+\s+){0,4}?from\s+(?:my\s+|the\s+|this\s+|that\s+)?order|(?:remove|take\s+(?:off|out))\s+(?:the|one|a|my)\s+\w+|(?:don'?t|do not|no longer)\s+(?:want|need)\s+(?:the|one|both|a)\s+\w+|(?:reduce|lower|decrease)\s+(?:the\s+)?(?:quantity|qty|amount)|only\s+(?:want|need|keep)\s+(?:one|1)\b|(?:hiq|largo|fshi)\w*|vet[eë]m\s+nj[eë]\s+\w+|zvog[eë]lo\w*\s+sasi\w*)\b`,
    ),
  ],
  [
    "cancel",
    rx(
      String.raw`\b(cancel\w*|call\s+off\s+(?:my\s+|the\s+)?order|(?:don'?t|do not|no longer)\s+want\s+(?:the|my|this|that)\s+order|anul\w*|(?:nuk|s'?)\s*(?:e\s+)?dua\s+(?:m[eë]\s+)?porosi\w*|nd[eë]rpre\w*\s+porosi\w*)\b`,
    ),
  ],
  [
    "general",
    rx(String.raw`\b((?:change|modify|edit|amend)\w*\s+(?:\w+\s+){0,2}?order|(?:ndrysho|modifiko)\w*\s+(?:\w+\s+){0,2}?porosi\w*)\b`),
  ],
];

function readOrderChange(text: string): Detection & { kinds: OrderChangeKind[] } {
  const kinds: OrderChangeKind[] = [];
  const evidence: string[] = [];
  for (const [kind, re] of ORDER_CHANGE_RX) {
    const m = text.match(re);
    if (m) {
      kinds.push(kind);
      evidence.push(`Asks to change the order (${kind.replace("_", " ")}): “${m[0]}”`);
    }
  }
  return { hit: kinds.length > 0, kinds, evidence };
}

export function productCategoriesIn(text: string): ProductCategory[] {
  const t = normalize(text);
  return PRODUCTS.filter((p) => p.re.test(t)).map((p) => p.category);
}

export function detectOrderChange(texts: string[]): OrderChangeKind[] {
  return [...new Set(texts.flatMap((t) => readOrderChange(normalize(t)).kinds))];
}

// ---- intent ------------------------------------------------------------------

const RETURN_RX = rx(
  String.raw`\b(return\w*|refund\w*|send (?:it|them) back|money back|t[aeë] kthej|t'i kthej|kthej\w*|kthim\w*|rikthim\w*|rimburs\w*|par[aeë]t[eë]? mbrapsht)\b`,
);
const FAULT_RX = rx(
  String.raw`\b(broken|faulty|defect\w*|damaged|cracked|doesn'?t work|does not work|not working|won'?t (?:turn on|power on|charge|start|boot)|stopped working|dead|repair\w*|warranty|garanci\w*|prish(?!t)\w*|defekt\w*|nuk (?:punon\w*|punoj\w*|ndiz\w*|karikoh\w*)|s'?punon\w*|s'?punoj\w*|s'?ndiz\w*|riparim\w*|servis\w*|i thyer|e thyer)\b`,
);
const DELIVERY_INFO_RX = rx(
  String.raw`\b(shipping (?:cost|fee|price|time)|delivery (?:cost|fee|price|time|charge)|how much (?:is|does) (?:shipping|delivery)|do you (?:deliver|ship)|deliver to|ship to|how long (?:does|will) (?:delivery|shipping|it take)|free (?:shipping|delivery)|sa kushton (?:d[eë]rgesa|transporti|posta)|a d[eë]rgoni|d[eë]rgoni n[eë]|a b[eë]ni d[eë]rgesa|sa dit[eë] (?:zgjat|merr)|transport(?:i)? falas)\b`,
);
const ORDER_LIST_RX = rx(
  String.raw`\b(how many orders|how many order\b|my orders|what orders|list (?:all )?(?:my )?orders|check (?:how many orders|(?:all )?(?:my )?orders)|show (?:all )?(?:my )?orders|view (?:all )?(?:my )?orders|see (?:all )?(?:my )?orders|all (?:of )?my orders|any orders|order history|sa porosi\b|porosit[eë] e mia|cilat jan[eë] porosit[eë]|shiko porosit[eë]|m[eë] trego porosit[eë]|a kam (?:ndonj[eë] )?porosi|kam porosi)\b`,
);
const STATUS_RX = rx(
  String.raw`\b(where(?:'s| is) my|my order|status of my|check (?:my|on my) (?:order|package|parcel)|status\w*|porosi\w* (?:ime|time|t[eë] mia)|ku [eë]sht[eë] porosia|kontrollo\w* porosi\w*|hasn'?t (?:arrived|come)|has not (?:arrived|come)|not (?:arrived|delivered|received)|didn'?t (?:arrive|get)|never (?:arrived|received)|still (?:not|no|waiting)|tracking|track (?:my|the)|delivery status|order status|when will (?:it|my order)|delayed?|delay|late|s'?ka ardhur|nuk ka ardhur|nuk (?:m[eë] )?ka arritur|s'?ka arritur|ende s'|ende nuk|ku [eë]sht[eë] porosia|kur (?:vjen|arrin|do t[eë] vij[eë])|vones[eë]\w*|gjurmim\w*)`,
);
const PAYMENT_RX = rx(
  String.raw`\b(pay (?:by|with|in cash|cash|by card)|payment (?:methods?|options?)|cash on delivery|credit card|debit card|card payment|bank transfer|paypal|paguaj\w*|pages[aeë]\w*|kartel\w*|cash|para n[eë] dor[eë]|transfert\w* bankare)\b`,
);
const STORE_RX = rx(
  String.raw`\b(opening hours|open(?:ing)? times|hours|when (?:are|do) you (?:open|close)|are you open|where (?:are|is) (?:you|your (?:shop|store))|your (?:shop|store) address|store location|orari|orar\w*|ku ndodh\w*|ku jeni|jeni hapur|punoni (?:sot|t[eë] diel[eë]n|t[eë] shtun[eë]n))\b`,
);

const PRODUCT_SEARCH_RX = rx(
  String.raw`\b(do you (?:have|sell|carry|stock)|what (?:laptops?|phones?|headphones?|chargers?|models?) do you|which (?:models?|laptops?|phones?|headphones?|chargers?)|in stock|out of stock|available in (?:store|stock)|recommend (?:a|an|me|some)|looking for (?:a |an |some )?(?:new )?(?:laptop|phone|smartphone|headphones?|earbuds|charger)|how much (?:is|are|does|do) (?:the|a|an|your) (?!shipping|delivery)|price (?:of|for)|prices? (?:on|for) (?:your )?(?:laptops?|phones?|headphones?|chargers?)|cheapest|(?:under|below|less than|up to) €?\s?\d+|a keni (?:n[eë] stok|laptop\w*|telefon\w*|kufje\w*|karikues\w*|iphone|samsung|xiaomi)|a shitni|n[eë] stok|sa kushton (?!d[eë]rgesa|transporti|posta)|sa kushtojn[eë]|[çc]mim\w* (?:e|i|p[eë]r)|m[eë] i liri|m[eë] e lira|m[eë] t[eë] lir[eë]t?|n[eë]n €?\s?\d+|m[eë] rekomando\w*|[çc]far[eë] (?:laptop\w*|telefon\w*|kufje\w*|karikues\w*|modele) keni)`,
);
const PRICE_CAP = rx(
  String.raw`(?:under|below|less than|up to|max(?:imum)?|budget(?: of)?|n[eë]n|deri(?: n[eë])?|maksimum)\s*(?:€|eur(?:o|os)?\s*)?\s*(\d{1,5})(?:\s*(?:€|eur\w*))?`,
);

const MISSING_RX = rx(
  String.raw`\b(nuk mund ta gjej|s'?mund ta gjej|nuk e gjej|s'?e gjej|nuk e kam marr[eë]|s'?e kam marr[eë]|nuk m[eë] ka ardhur|s'?m[eë] ka ardhur|can'?t find (?:it|my (?:order|package|parcel))|cannot find (?:it|my)|didn'?t (?:receive|get) (?:it|my)|never (?:received|got) (?:it|my)|not received|haven'?t received)`,
);
const GREETING_RX = rx(
  String.raw`^\s*(hi|hello|hey|good (?:morning|afternoon|evening)|p[eë]rsh[eë]ndetje|tungjatjeta|tung|mir[eë]dita|mir[eë]m[eë]ngjes|mir[eë]mbr[eë]ma|[çc]'?kemi|si jeni|si je|how are you)\b`,
);
const THANKS_RX = rx(
  String.raw`\b(thanks|thank you|thx|faleminderit|flm|rrofsh|ok|okay|oke|n[eë] rregull|great|perfect|perfekt)\b`,
);
const HELP_RX = rx(
  String.raw`\b(what can you (?:do|help)|who are you|how can you help|[çc]far[eë] mund t[eë] b[eë]sh|kush je|si mund t[eë] m[eë] ndihmosh|help me|m[eë] ndihmo)\b`,
);

function readSmallTalk(text: string): Signals["smallTalk"] {
  if (HELP_RX.test(text)) return "help";
  if (GREETING_RX.test(text)) return "greeting";
  if (THANKS_RX.test(text) && text.split(/\s+/).length <= 6) return "thanks";
  return undefined;
}

function matches(re: RegExp, text: string): string | undefined {
  const m = text.match(re);
  return m?.[0];
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function readFrustration(text: string): Detection {
  const evidence: string[] = [];
  let score = 0;
  const hostile = matches(HOSTILE, text);
  if (hostile) {
    score += 2;
    evidence.push(`Hostile wording: “${hostile}”`);
  }
  const caps = (text.match(/\p{L}+/gu) ?? []).filter(
    (w) => w.length >= 4 && w === w.toUpperCase() && w !== w.toLowerCase() && !ACRONYMS.has(w),
  );
  if (caps.length) {
    score += Math.min(caps.length, 2);
    evidence.push(`Shouting in caps: ${caps.map((c) => `“${c}”`).join(", ")}`);
  }
  if (/!{2,}/.test(text)) {
    score += 1;
    evidence.push("Repeated exclamation marks “!!”");
  }
  return { hit: score >= 2, evidence };
}

function readRepeat(text: string): Detection {
  const evidence: string[] = [];
  const ord = text.match(ORDINAL_TIME);
  if (ord && Number(ord[1]) >= 2) evidence.push(`Says it's the “${ord[0]}”`);
  const wordOrd = matches(WORD_ORDINAL_TIME, text);
  if (wordOrd) evidence.push(`Says it's the “${wordOrd}”`);
  const en = matches(REPEAT_EN, text);
  if (en) evidence.push(`Repeat-contact phrase: “${en}”`);
  const sq = matches(REPEAT_SQ, text);
  if (sq) evidence.push(`Repeat-contact phrase: “${sq}”`);
  return { hit: evidence.length > 0, evidence };
}

function readThirdParty(text: string): Detection & { relation?: string } {
  const named = text.match(THIRD_EN_NAMED);
  if (named && !/^(my|your|it|that|this|he|she|there|what|who)$/i.test(named[1])) {
    return { hit: true, evidence: [`Identifies as “${named[0]}”`], relation: named[0] };
  }
  const en = matches(THIRD_EN, text);
  if (en) return { hit: true, evidence: [`Acting for someone else: “${en}”`], relation: en };
  const sq = matches(THIRD_SQ, text);
  if (sq) return { hit: true, evidence: [`Acting for someone else: “${sq}”`], relation: sq };
  return { hit: false, evidence: [] };
}

function readPersonalData(
  text: string,
  hasOrderRef: boolean,
  thirdParty: boolean,
): Detection & { fields: PiiField[] } {
  const cleaned = text.replace(SELF_STATEMENT, " ");
  if (SHOP_CONTEXT.test(cleaned)) return { hit: false, evidence: [], fields: [] };
  const fields: PiiField[] = [];
  const evidence: string[] = [];
  const sentences = cleaned.split(/(?<=[.!?\n])/);
  for (const sentence of sentences) {
    const asking = ASKING.test(sentence) || sentence.trim().endsWith("?");
    const personal = hasOrderRef || thirdParty || PERSONAL_CONTEXT.test(sentence);
    if (!asking || !personal) continue;
    for (const field of Object.keys(PII_FIELDS) as PiiField[]) {
      if (field === "address" && ORDER_CHANGE_RX[0][1].test(sentence)) continue;
      const m = sentence.match(PII_FIELDS[field]);
      if (m && !fields.includes(field)) {
        fields.push(field);
        evidence.push(`Asks for ${field}: “${sentence.trim()}”`);
      }
    }
  }
  return { hit: fields.length > 0, evidence, fields };
}

function readTopic(text: string): Detection & { topicId?: string } {
  for (const topic of TOPIC_DETECTORS) {
    const m = text.match(topic.re);
    if (m) return { hit: true, topicId: topic.id, evidence: [`Mentions “${m[0]}” → ${topic.label}`] };
  }
  return { hit: false, evidence: [] };
}

/** A detected topic is a policy gap when the policies table has no row for it. */
function readPolicyGap(topic: Detection & { topicId?: string }, book: PolicyBook | undefined): Signals["policyGap"] {
  if (!topic.hit || !topic.topicId || !book || covers(book, topic.topicId)) return { hit: false, evidence: [] };
  return { hit: true, topicId: topic.topicId, evidence: [`${topic.evidence[0]} (no written policy)`] };
}

function readPriceCap(text: string): number | undefined {
  const m = text.match(PRICE_CAP);
  return m ? Number(m[1]) : undefined;
}

function readStatedDays(text: string): number | undefined {
  const d = [...text.matchAll(DAYS)].map((m) => Number(m[1]));
  if (d.length) return Math.max(...d);
  const w = [...text.matchAll(WEEKS)].map((m) => Number(m[1]) * 7);
  if (w.length) return Math.max(...w);
  return undefined;
}

function readIntent(
  text: string,
  s: Omit<Signals, "intent" | "language">,
): { value: Intent; evidence: string[] } {
  const missing = matches(MISSING_RX, text);
  if (s.orderChange.hit) return { value: "order_change", evidence: s.orderChange.evidence };
  if (s.personalData.hit) return { value: "personal_data_request", evidence: s.personalData.evidence };
  if (s.topic.hit) {
    return { value: s.topic.topicId === "installments" ? "financing" : "other", evidence: s.topic.evidence };
  }
  const orderList = matches(ORDER_LIST_RX, text);
  if (orderList) return { value: "order_list", evidence: [`Keyword “${orderList}”`] };
  const checks: [Intent, RegExp][] = [
    ["return_request", RETURN_RX],
    ["product_fault", FAULT_RX],
  ];
  for (const [intent, re] of checks) {
    const m = matches(re, text);
    if (m) return { value: intent, evidence: [`Keyword “${m}”`] };
  }
  if (missing && (s.orderIds.length || s.contextOrderId)) {
    return { value: "order_status", evidence: [`Can't find the parcel: “${missing}”`] };
  }
  const delivery = matches(DELIVERY_INFO_RX, text);
  if (delivery && !s.orderIds.length) return { value: "delivery_info", evidence: [`Keyword “${delivery}”`] };
  const status = matches(STATUS_RX, text);
  if (status) return { value: "order_status", evidence: [`Keyword “${status}”`] };
  if (s.orderIds.length) return { value: "order_status", evidence: [`Mentions order #${s.orderIds[0]}`] };
  const productSearch = matches(PRODUCT_SEARCH_RX, text);
  if (productSearch) return { value: "product_search", evidence: [`Keyword “${productSearch}”`] };
  const pay = matches(PAYMENT_RX, text);
  if (pay) return { value: "payment_methods", evidence: [`Keyword “${pay}”`] };
  const store = matches(STORE_RX, text);
  if (store) return { value: "store_info", evidence: [`Keyword “${store}”`] };
  if (s.smallTalk) return { value: "small_talk", evidence: [`Small talk (${s.smallTalk})`] };
  return { value: "other", evidence: ["No known topic matched"] };
}

function lastOrderIdIn(texts: string[]): string | undefined {
  for (const t of [...texts].reverse()) {
    const n = normalize(t);
    const id = [...n.matchAll(ORDER_HASH)].map((m) => m[1])[0] ?? [...n.matchAll(ORDER_WORD)].map((m) => m[1])[0];
    if (id) return id;
  }
  return undefined;
}

/**
 * @param priorTexts earlier messages from the same sender in this conversation,
 *   so a third-party claim made once keeps applying to the whole thread.
 * @param book the policy book from the database; a detected topic without a row is a policy gap.
 */
export function extractSignals(rawText: string, priorTexts: string[] = [], book?: PolicyBook): Signals {
  const text = normalize(rawText);
  const orderIds = uniq([
    ...[...text.matchAll(ORDER_HASH)].map((m) => m[1]),
    ...[...text.matchAll(ORDER_WORD)].map((m) => m[1]),
  ]);
  const statedEmails = uniq(text.match(EMAIL) ?? []);
  const statedPhones = uniq(text.match(PHONE) ?? []);
  const product = PRODUCTS.find((p) => p.re.test(text))?.category;

  let thirdParty = readThirdParty(text);
  if (!thirdParty.hit) {
    for (const prior of priorTexts) {
      const earlier = readThirdParty(normalize(prior));
      if (earlier.hit) {
        thirdParty = {
          hit: true,
          relation: earlier.relation,
          evidence: [`Earlier in this thread: ${earlier.evidence[0]}`],
        };
        break;
      }
    }
  }

  const boxOpened = SEALED.test(text) ? false : OPENED.test(text) ? true : null;
  const topic = readTopic(text);

  const base = {
    orderIds,
    statedEmails,
    statedPhones,
    product,
    statedDays: readStatedDays(text),
    boxOpened,
    frustration: readFrustration(text),
    repeat: readRepeat(text),
    thirdParty,
    personalData: readPersonalData(text, orderIds.length > 0, thirdParty.hit),
    topic,
    policyGap: readPolicyGap(topic, book),
    contextOrderId: orderIds.length ? undefined : lastOrderIdIn(priorTexts),
    reportsMissing: MISSING_RX.test(text),
    orderChange: readOrderChange(text),
    priceCap: readPriceCap(text),
    smallTalk: readSmallTalk(text),
  };

  return {
    ...base,
    language: detectLanguage(text),
    intent: readIntent(text, base),
  };
}
