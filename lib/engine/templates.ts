import { OPS } from "@/lib/shop/operations";
import { formatDay, parseDay } from "./text";
import { topicInfo } from "./topics";
import type { BriefKind, BriefValue, Language, PiiField, ProductCategory, ReplyBrief } from "./types";

/*
 * Pre-approved reply drafts in both languages. These are what the customer gets
 * whenever no phrasing model is configured, or when a model's rewrite fails
 * validation. Every number and fact in them comes from the brief, which the rules
 * filled from the database and the policies table.
 */

type Params = Record<string, BriefValue>;
type Render = (p: Params) => string;

const PRODUCT: Record<ProductCategory, { en: string; sq: string; sqAcc: string; plural: boolean }> = {
  headphones: { en: "the headphones", sq: "kufjet", sqAcc: "kufjet", plural: true },
  laptop: { en: "the laptop", sq: "laptopi", sqAcc: "laptopin", plural: false },
  phone: { en: "the phone", sq: "telefoni", sqAcc: "telefonin", plural: false },
  charger: { en: "the charger", sq: "karikuesi", sqAcc: "karikuesin", plural: false },
};
const GENERIC_PRODUCT = { en: "this item", sq: "produkti", sqAcc: "produktin", plural: false };

const PII_SQ: Record<PiiField, string> = {
  address: "Adresa e dorëzimit e regjistruar",
  phone: "Numri i telefonit i regjistruar",
  email: "Email-i i regjistruar",
};
const PII_EN: Record<PiiField, string> = {
  address: "delivery address",
  phone: "phone number",
  email: "email",
};

const n = (v: BriefValue) => Number(v);
const s = (v: BriefValue) => (v === undefined ? "" : String(v));
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const product = (p: Params) => PRODUCT[p.product as ProductCategory] ?? GENERIC_PRODUCT;

function ago(days: number, lang: Language): string {
  if (lang === "en") return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
  return days === 0 ? "sot" : days === 1 ? "para 1 dite" : `para ${days} ditësh`;
}

function hi(p: Params, lang: Language): string {
  if (lang === "en") return p.name ? `Hi ${s(p.name)}! ` : "Hi! ";
  return p.name ? `Përshëndetje ${s(p.name)}! ` : "Përshëndetje! ";
}

function topic(p: Params) {
  return topicInfo(s(p.topicId) || undefined);
}

const day = (v: BriefValue, lang: Language) => formatDay(parseDay(s(v)), lang);
const windowEn = (p: Params) => `${s(p.windowMin)}–${s(p.windowMax)}${p.workingDays ? " working" : ""} days`;
const windowSq = (p: Params) => `${s(p.windowMin)}–${s(p.windowMax)} ditë${p.workingDays ? " pune" : ""}`;

/** What the assistant can help with, from the policy topics that exist. */
const CAN_HELP: Record<string, Record<Language, string>> = {
  delivery: { en: "check where an order is", sq: "të kontrolloj ku është porosia juaj" },
  returns: { en: "explain returns", sq: "t'ju shpjegoj kthimet" },
  warranty: { en: "pass a faulty product to our team", sq: "t'ia kaloj ekipit një produkt me defekt" },
};
function canHelp(p: Params, lang: Language): string {
  const topics = ((p.topics as string[]) ?? []).filter((t) => CAN_HELP[t]).map((t) => CAN_HELP[t][lang]);
  if (!topics.length) return lang === "en" ? "help with your order" : "t'ju ndihmoj me porosinë tuaj";
  const last = topics.pop()!;
  return topics.length ? `${topics.join(", ")} ${lang === "en" ? "or" : "ose"} ${last}` : last;
}

function warrantyNote(p: Params, pr: { plural: boolean }, lang: Language): string {
  if (p.warrantyKind === "months") {
    return lang === "en"
      ? ` If something is faulty, ${pr.plural ? "they're" : "it's"} still covered by our ${s(p.warrantyMonths)}-month warranty — just reply with a short description and we'll arrange a check.`
      : ` Nëse ka ndonjë defekt, produkti mbulohet ende nga garancia jonë ${s(p.warrantyMonths)}-mujore — na shkruani shkurt problemin dhe do të organizojmë një kontroll.`;
  }
  if (p.warrantyKind === "human_staff") {
    return lang === "en"
      ? " If something is faulty, reply with a short description and a member of our staff will take care of it."
      : " Nëse ka ndonjë defekt, na shkruani shkurt problemin dhe një anëtar i stafit tonë do të merret me të.";
  }
  return "";
}

const TEMPLATES: Record<BriefKind, Record<Language, Render>> = {
  order_late: {
    en: (p) =>
      `${hi(p, "en")}I'm sorry — order #${s(p.orderId)} was due by ${day(p.expectedBy, "en")} at the latest (our delivery time is ${windowEn(p)}), so it is now ${n(p.daysLate)} day${n(p.daysLate) === 1 ? "" : "s"} late. It's on its way with ${s(p.carrier)} (last courier update: ${day(p.lastUpdate, "en")}). I've opened a priority trace with the courier (${s(p.traceId)}) and we'll let you know as soon as they reply.`,
    sq: (p) =>
      `${hi(p, "sq")}Na vjen keq — porosia #${s(p.orderId)} duhej të arrinte më së voni më ${day(p.expectedBy, "sq")} (afati ynë i dërgesës është ${windowSq(p)}), pra tani është ${n(p.daysLate)} ${n(p.daysLate) === 1 ? "ditë" : "ditë"} me vonesë. Është në rrugë me ${s(p.carrier)} (përditësimi i fundit i korrierit: ${day(p.lastUpdate, "sq")}). Kam hapur një kërkim prioritar te korrieri (${s(p.traceId)}) dhe do t'ju njoftojmë sapo të kemi përgjigje.`,
  },
  order_on_time: {
    en: (p) =>
      `${hi(p, "en")}Order #${s(p.orderId)} ${p.shipped ? `is on its way with ${s(p.carrier)}` : "is being prepared for dispatch"} and is expected between ${day(p.expectedFrom, "en")} and ${day(p.expectedBy, "en")}, in line with our ${windowEn(p)} delivery time.`,
    sq: (p) =>
      `${hi(p, "sq")}Porosia #${s(p.orderId)} ${p.shipped ? `është në rrugë me ${s(p.carrier)}` : "po përgatitet për dërgim"} dhe pritet të arrijë ndërmjet ${day(p.expectedFrom, "sq")} dhe ${day(p.expectedBy, "sq")}, sipas afatit tonë të dërgesës prej ${windowSq(p)}.`,
  },
  order_delivered: {
    en: (p) =>
      `${hi(p, "en")}Order #${s(p.orderId)} was delivered ${ago(n(p.deliveredDays), "en")}. If you can't find it, reply here and we'll check the delivery with the courier.`,
    sq: (p) =>
      `${hi(p, "sq")}Porosia #${s(p.orderId)} është dorëzuar ${ago(n(p.deliveredDays), "sq")}. Nëse nuk e gjeni, na shkruani këtu dhe do ta verifikojmë dorëzimin me korrierin.`,
  },
  return_declined: {
    en: (p) => {
      const pr = product(p);
      const reasons = (p.reasons as string[]) ?? [];
      const days = n(p.days);
      const fromRecord = p.daysSource === "record";
      let reason: string;
      if (reasons.includes("window") && reasons.includes("opened")) {
        reason = `${fromRecord ? `Your order was delivered ${ago(days, "en")}` : `It's been ${days} days`} and the item has been opened, so neither condition is met.`;
      } else if (reasons.includes("window")) {
        reason = `${fromRecord ? `Your order was delivered ${ago(days, "en")}` : `After ${days} days`}, which is past the ${s(p.returnWindow)}-day window.`;
      } else {
        reason = "Since the item has been opened, it no longer qualifies.";
      }
      const rule = `Our policy accepts returns within ${s(p.returnWindow)} days of delivery${p.unopenedOnly ? ", and only for unopened items" : ""}.`;
      return `${hi(p, "en")}Thanks for asking. Unfortunately ${pr.en} can't be returned. ${rule} ${reason}${warrantyNote(p, pr, "en")}`;
    },
    sq: (p) => {
      const pr = product(p);
      const reasons = (p.reasons as string[]) ?? [];
      const days = n(p.days);
      const fromRecord = p.daysSource === "record";
      let reason: string;
      if (reasons.includes("window") && reasons.includes("opened")) {
        reason = `${fromRecord ? `Porosia juaj është dorëzuar ${ago(days, "sq")}` : `Kanë kaluar ${days} ditë`} dhe produkti është hapur, prandaj asnjëri kusht nuk plotësohet.`;
      } else if (reasons.includes("window")) {
        reason = fromRecord
          ? `Porosia juaj është dorëzuar ${ago(days, "sq")}, pra pas afatit prej ${s(p.returnWindow)} ditësh.`
          : `Pas ${days} ditësh, afati prej ${s(p.returnWindow)} ditësh ka kaluar.`;
      } else {
        reason = "Meqë produkti është hapur, nuk kualifikohet më për kthim.";
      }
      const rule = `Politika jonë pranon kthime brenda ${s(p.returnWindow)} ditëve nga dorëzimi${p.unopenedOnly ? ", dhe vetëm për produkte të pahapura" : ""}.`;
      return `${hi(p, "sq")}Faleminderit për pyetjen. Fatkeqësisht, ${pr.sq} nuk mund të ${pr.plural ? "kthehen" : "kthehet"}. ${rule} ${reason}${warrantyNote(p, pr, "sq")}`;
    },
  },
  return_eligible: {
    en: (p) =>
      `${hi(p, "en")}Good news: order #${s(p.orderId)} was delivered ${ago(n(p.days), "en")}, within our ${s(p.returnWindow)}-day return window, and our records show ${product(p).en} unopened, so you can return ${product(p).plural ? "them" : "it"}. Reply here and a colleague will arrange the return with you.`,
    sq: (p) =>
      `${hi(p, "sq")}Lajm i mirë: porosia #${s(p.orderId)} është dorëzuar ${ago(n(p.days), "sq")}, brenda afatit tonë prej ${s(p.returnWindow)} ditësh për kthim, dhe sipas të dhënave tona produkti është i pahapur, prandaj mund ta ktheni. Na shkruani këtu dhe një koleg do ta organizojë kthimin me ju.`,
  },
  return_info: {
    en: (p) =>
      `${hi(p, "en")}Our policy: returns are accepted within ${s(p.returnWindow)} days of delivery${p.unopenedOnly ? ", for unopened items" : ""}. Send us your order number${p.unopenedOnly ? " and let us know whether the box is still sealed" : ""}, and we'll check it for you.`,
    sq: (p) =>
      `${hi(p, "sq")}Sipas politikës sonë, kthimet pranohen brenda ${s(p.returnWindow)} ditëve nga dorëzimi${p.unopenedOnly ? ", për produkte të pahapura" : ""}. Na dërgoni numrin e porosisë${p.unopenedOnly ? " dhe na tregoni nëse kutia është ende e mbyllur" : ""}, dhe do ta kontrollojmë për ju.`,
  },
  warranty_repair: {
    en: (p) =>
      `${hi(p, "en")}Sorry to hear about ${product(p).en}. Order #${s(p.orderId)} is covered by our ${s(p.warrantyMonths)}-month warranty (${s(p.monthsLeft)} months left). Reply here with a short description of the problem and we'll arrange a check.`,
    sq: (p) =>
      `${hi(p, "sq")}Na vjen keq për problemin me ${product(p).sqAcc}. Porosia #${s(p.orderId)} mbulohet nga garancia jonë ${s(p.warrantyMonths)}-mujore (edhe ${s(p.monthsLeft)} muaj). Na shkruani shkurt problemin dhe do të organizojmë një kontroll.`,
  },
  warranty_handoff: {
    en: (p) =>
      `${hi(p, "en")}I'm sorry ${product(p).en} ${product(p).plural ? "aren't" : "isn't"} working${p.orderId ? ` (order #${s(p.orderId)})` : ""}. Faulty items are handled personally by our staff, so I've passed your message to a colleague who will contact you within ${s(p.slaHours)} hours.`,
    sq: (p) =>
      `${hi(p, "sq")}Na vjen keq që ${product(p).sq} nuk ${product(p).plural ? "punojnë" : "punon"}${p.orderId ? ` (porosia #${s(p.orderId)})` : ""}. Produktet me defekt i trajton personalisht stafi ynë, prandaj mesazhin tuaj ia kalova një kolegu, i cili do t'ju kontaktojë brenda ${s(p.slaHours)} orëve.`,
  },
  pii_disclose: {
    en: (p) => {
      const fields = (p.fields as PiiField[]) ?? [];
      const values = (p.values as string[]) ?? [];
      const lines = fields.map((f, i) => `The ${PII_EN[f]} on file is ${values[i]}.`).join(" ");
      return `${hi(p, "en")}You're verified as the buyer on order #${s(p.orderId)}. ${lines}`;
    },
    sq: (p) => {
      const fields = (p.fields as PiiField[]) ?? [];
      const values = (p.values as string[]) ?? [];
      const lines = fields.map((f, i) => `${PII_SQ[f]} është ${values[i]}.`).join(" ");
      return `${hi(p, "sq")}Jeni verifikuar si blerësi i porosisë #${s(p.orderId)}. ${lines}`;
    },
  },
  pii_third_party: {
    en: (p) =>
      `Thanks for reaching out. For privacy reasons we can only share order details such as the delivery address, phone number or email with the buyer themselves. Please ask the buyer to contact us directly from the phone number or email used for order #${s(p.orderId)} — we'll gladly help them there.`,
    sq: (p) =>
      `Faleminderit që na kontaktuat. Për arsye privatësie, detajet e porosisë si adresa e dorëzimit, numri i telefonit ose email-i mund të ndahen vetëm me vetë blerësin. Ju lutemi kërkojini blerësit të na kontaktojë drejtpërdrejt nga numri i telefonit ose email-i i përdorur për porosinë #${s(p.orderId)} — do ta ndihmojmë me kënaqësi.`,
  },
  pii_unverified: {
    en: (p) =>
      `For privacy, we only share the address, phone number or email on an order with the verified buyer. Please write to us from the phone number or email used for order #${s(p.orderId)}, or reply with both the email and the phone number on the order so we can verify you.`,
    sq: (p) =>
      `Për arsye privatësie, adresën, numrin e telefonit ose email-in e një porosie i ndajmë vetëm me blerësin e verifikuar. Ju lutemi na shkruani nga numri i telefonit ose email-i i përdorur për porosinë #${s(p.orderId)}, ose na dërgoni si email-in ashtu edhe numrin e telefonit të porosisë që t'ju verifikojmë.`,
  },
  order_unverified: {
    en: (p) =>
      `For privacy, we can only share details of order #${s(p.orderId)} with the person who placed it. Please write to us from the phone number or email used for that order, or reply with both the email and the phone number on it so we can verify you.`,
    sq: (p) =>
      `Për arsye privatësie, detajet e porosisë #${s(p.orderId)} mund t'i ndajmë vetëm me personin që e ka bërë. Ju lutemi na shkruani nga numri i telefonit ose email-i i përdorur për atë porosi, ose na dërgoni si email-in ashtu edhe numrin e telefonit të saj që t'ju verifikojmë.`,
  },
  verify_generic: {
    en: () =>
      "Before I go any further, I need to confirm you're the buyer. Please write to us from the phone number or email used for the order, or reply with both the email and phone number on it.",
    sq: () =>
      "Para se të vazhdoj, duhet të konfirmoj që jeni blerësi. Ju lutemi na shkruani nga numri i telefonit ose email-i i përdorur për porosinë, ose na dërgoni si email-in ashtu edhe numrin e telefonit të porosisë.",
  },
  need_order_number: {
    en: () =>
      "Happy to check that for you. Could you send us your order number? You'll find it in your order confirmation message.",
    sq: () =>
      "Me kënaqësi e kontrollojmë. A mund të na dërgoni numrin e porosisë? E gjeni te mesazhi i konfirmimit të porosisë.",
  },
  order_not_found: {
    en: (p) =>
      `We couldn't find order #${s(p.orderId)} in our system. Could you double-check the number in your order confirmation message?`,
    sq: (p) =>
      `Nuk e gjetëm porosinë #${s(p.orderId)} në sistemin tonë. A mund ta kontrolloni edhe një herë numrin te mesazhi i konfirmimit të porosisë?`,
  },
  delivery_info: {
    en: (p) => `Delivery takes ${windowEn(p)}. If you already have an order with us, send the order number and I'll check it for you.`,
    sq: (p) => `Dërgesa zgjat ${windowSq(p)}. Nëse keni tashmë një porosi te ne, na dërgoni numrin e porosisë dhe do ta kontrolloj për ju.`,
  },
  policy_quote: {
    en: (p) => `Here is our policy on this: “${s(p.text)}” If you'd like anything checked for your own order, just send the order number.`,
    sq: (p) => `Ja politika jonë për këtë: “${s(p.text)}” Nëse doni që ta kontrollojmë për porosinë tuaj, na dërgoni numrin e porosisë.`,
  },
  escalate_upset: {
    en: (p) =>
      `${p.name ? `${s(p.name)}, I'm` : "I'm"} really sorry you've had to write again — that shouldn't happen. I've passed your message, together with your earlier ones, straight to a senior member of our team as a priority. They'll contact you personally within ${s(p.slaHours)} hours (during opening hours), so you won't need to repeat anything.`,
    sq: (p) =>
      `${p.name ? `${s(p.name)}, na` : "Na"} vjen shumë keq që u desh të na shkruani sërish — kjo nuk duhej të ndodhte. Mesazhin tuaj, bashkë me ato të mëparshmet, ia kalova menjëherë me prioritet një kolegu të lartë nga ekipi ynë. Do t'ju kontaktojë personalisht brenda ${s(p.slaHours)} orëve (gjatë orarit të punës), që të mos keni nevojë të përsërisni asgjë.`,
  },
  escalate_policy_gap: {
    en: (p) =>
      `Thanks for your question! ${cap(topic(p)?.en ?? "This")} isn't something I can confirm myself, so I've passed your question to a colleague who will reply within ${s(p.slaHours)} hours.`,
    sq: (p) =>
      `Faleminderit për pyetjen! Për ${topic(p)?.sq ?? "këtë çështje"} nuk mund t'ju jap përgjigje vetë, prandaj pyetjen tuaj ia kalova një kolegu, i cili do t'ju përgjigjet brenda ${s(p.slaHours)} orëve.`,
  },
  escalate_no_policy: {
    en: (p) =>
      `Thanks for your message. I want to make sure you get the right answer, so I've passed it to a colleague who will reply within ${s(p.slaHours)} hours.`,
    sq: (p) =>
      `Faleminderit për mesazhin. Dua të sigurohem që të merrni përgjigjen e duhur, prandaj ia kalova një kolegu, i cili do t'ju përgjigjet brenda ${s(p.slaHours)} orëve.`,
  },
  escalate_policy_limit: {
    en: (p) =>
      `${hi(p, "en")}I'm sorry — order #${s(p.orderId)} was due by ${day(p.expectedBy, "en")} and still hasn't reached you. I've passed it to a colleague as a priority; they'll contact you within ${s(p.slaHours)} hours to agree the next step with you.`,
    sq: (p) =>
      `${hi(p, "sq")}Na vjen keq — porosia #${s(p.orderId)} duhej të arrinte deri më ${day(p.expectedBy, "sq")} dhe ende nuk ju ka arritur. Ia kalova me prioritet një kolegu, i cili do t'ju kontaktojë brenda ${s(p.slaHours)} orëve për të vendosur bashkë hapin e radhës.`,
  },
  escalate_missing_parcel: {
    en: (p) =>
      `${hi(p, "en")}I'm sorry you can't find it. Our records show order #${s(p.orderId)} was delivered ${ago(n(p.deliveredDays), "en")}. I've opened a delivery check with the courier and passed it to a colleague, who will contact you within ${s(p.slaHours)} hours.`,
    sq: (p) =>
      `${hi(p, "sq")}Na vjen keq që nuk e gjeni. Sipas të dhënave tona, porosia #${s(p.orderId)} është dorëzuar ${ago(n(p.deliveredDays), "sq")}. Kam hapur një verifikim të dorëzimit te korrieri dhe ia kalova një kolegu, i cili do t'ju kontaktojë brenda ${s(p.slaHours)} orëve.`,
  },
  conversation: {
    en: (p) =>
      p.variant === "thanks"
        ? "You're welcome! If you need anything else with an order, just write here."
        : `Hi! I'm the ${OPS.shopName} support assistant. I can ${canHelp(p, "en")}. What can I help you with?`,
    sq: (p) =>
      p.variant === "thanks"
        ? "S'ka përse! Nëse keni nevojë për diçka tjetër me një porosi, na shkruani këtu."
        : `Përshëndetje! Jam asistenti i mbështetjes së ${OPS.shopName}. Mund ${canHelp(p, "sq")}. Si mund t'ju ndihmoj?`,
  },
  escalate_review: {
    en: (p) =>
      `Thanks for your message. I've asked a colleague to take a look so you get an accurate answer — they'll reply within ${s(p.slaHours ?? 24)} hours.`,
    sq: (p) =>
      `Faleminderit për mesazhin. I kërkova një kolegu ta shqyrtojë, që të merrni një përgjigje të saktë — do t'ju përgjigjet brenda ${s(p.slaHours ?? 24)} orëve.`,
  },
};

export function renderDraft(brief: ReplyBrief, lang: Language): string {
  return TEMPLATES[brief.kind][lang](brief.params).replace(/\s+/g, " ").trim();
}
