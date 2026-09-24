import { SHOP, UNCOVERED_TOPICS } from "@/lib/data/shop";
import type { BriefKind, BriefValue, Language, PiiField, ProductCategory, ReplyBrief } from "./types";

/*
 * Pre-approved reply drafts in both languages. These are what the customer gets
 * whenever no phrasing model is configured, or when a model's rewrite fails
 * validation. Every number and fact in them comes from the brief.
 */

type Params = Record<string, BriefValue>;
type Render = (p: Params) => string;

const PRODUCT: Record<ProductCategory, { en: string; sq: string; sqAcc: string; plural: boolean }> = {
  headphones: { en: "the headphones", sq: "kufjet", sqAcc: "kufjet", plural: true },
  laptop: { en: "the laptop", sq: "laptopi", sqAcc: "laptopin", plural: false },
  tablet: { en: "the tablet", sq: "tableti", sqAcc: "tabletin", plural: false },
  phone: { en: "the phone", sq: "telefoni", sqAcc: "telefonin", plural: false },
  console: { en: "the console", sq: "konzola", sqAcc: "konzolën", plural: false },
  tv: { en: "the TV", sq: "televizori", sqAcc: "televizorin", plural: false },
  speaker: { en: "the speaker", sq: "altoparlanti", sqAcc: "altoparlantin", plural: false },
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
  return UNCOVERED_TOPICS.find((t) => t.id === p.topicId);
}

const TEMPLATES: Record<BriefKind, Record<Language, Render>> = {
  order_late: {
    en: (p) =>
      `${hi(p, "en")}I'm sorry — order #${s(p.orderId)} was placed ${ago(n(p.days), "en")}, which is ${n(p.daysLate)} day${n(p.daysLate) === 1 ? "" : "s"} past our ${s(p.windowMin)}–${s(p.windowMax)} day delivery window. It's in transit with ${s(p.carrier)}${p.lastScanEn ? ` (last scan: ${s(p.lastScanEn)}, ${ago(n(p.lastScanDays), "en")})` : ""}. I've opened a priority trace with the courier (${s(p.traceId)}) and we'll update you within ${s(p.traceHours)} hours. If it still hasn't arrived by day ${s(p.humanAfterDays)}, a colleague will contact you to arrange a refund or a replacement.`,
    sq: (p) =>
      `${hi(p, "sq")}Na vjen keq — porosia #${s(p.orderId)} është bërë ${ago(n(p.days), "sq")}, pra ${n(p.daysLate)} ditë përtej afatit tonë të dërgesës prej ${s(p.windowMin)}–${s(p.windowMax)} ditësh. Aktualisht është në transport me ${s(p.carrier)}${p.lastScanSq ? ` (skanimi i fundit: ${s(p.lastScanSq)}, ${ago(n(p.lastScanDays), "sq")})` : ""}. Kam hapur një kërkim prioritar te korrieri (${s(p.traceId)}) dhe do t'ju njoftojmë brenda ${s(p.traceHours)} orëve. Nëse nuk arrin deri në ditën e ${s(p.humanAfterDays)}-të, një koleg do t'ju kontaktojë për rimbursim ose zëvendësim.`,
  },
  order_on_time: {
    en: (p) =>
      `${hi(p, "en")}Order #${s(p.orderId)} was placed ${ago(n(p.days), "en")} and ${p.status === "processing" ? "is being prepared for dispatch" : `is on its way with ${s(p.carrier)}`}. That's within our ${s(p.windowMin)}–${s(p.windowMax)} day delivery window, so it should reach you within ${n(p.remaining)} day${n(p.remaining) === 1 ? "" : "s"}.`,
    sq: (p) =>
      `${hi(p, "sq")}Porosia #${s(p.orderId)} është bërë ${ago(n(p.days), "sq")} dhe ${p.status === "processing" ? "po përgatitet për dërgim" : `është në rrugë me ${s(p.carrier)}`}. Kjo është brenda afatit tonë prej ${s(p.windowMin)}–${s(p.windowMax)} ditësh, prandaj duhet t'ju arrijë brenda ${n(p.remaining)} ${n(p.remaining) === 1 ? "dite" : "ditësh"}.`,
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
        reason = `${fromRecord ? `Your order was delivered ${ago(days, "en")}` : `It's been ${days} days`} and the box has been opened, so neither condition is met.`;
      } else if (reasons.includes("window")) {
        reason = `${fromRecord ? `Your order was delivered ${ago(days, "en")}` : `After ${days} days`}, which is past the ${s(p.returnWindow)}-day window.`;
      } else {
        reason = "Since the box has been opened, it no longer qualifies.";
      }
      const warranty =
        p.warrantyActive === false
          ? ""
          : ` If something is faulty, ${pr.plural ? "they're" : "it's"} still covered by our ${s(p.warrantyMonths)}-month warranty — just reply with a short description and we'll arrange a check.`;
      return `${hi(p, "en")}Thanks for asking. Unfortunately ${pr.en} can't be returned. Our policy accepts returns within ${s(p.returnWindow)} days of delivery, and only for unopened items with the factory seal intact. ${reason}${warranty}`;
    },
    sq: (p) => {
      const pr = product(p);
      const reasons = (p.reasons as string[]) ?? [];
      const days = n(p.days);
      const fromRecord = p.daysSource === "record";
      let reason: string;
      if (reasons.includes("window") && reasons.includes("opened")) {
        reason = `${fromRecord ? `Porosia juaj është dorëzuar ${ago(days, "sq")}` : `Kanë kaluar ${days} ditë`} dhe kutia është hapur, prandaj asnjëri kusht nuk plotësohet.`;
      } else if (reasons.includes("window")) {
        reason = fromRecord
          ? `Porosia juaj është dorëzuar ${ago(days, "sq")}, pra pas afatit prej ${s(p.returnWindow)} ditësh.`
          : `Pas ${days} ditësh, afati prej ${s(p.returnWindow)} ditësh ka kaluar.`;
      } else {
        reason = "Meqë kutia është hapur, produkti nuk kualifikohet më për kthim.";
      }
      const warranty =
        p.warrantyActive === false
          ? ""
          : ` Nëse ka ndonjë defekt, produkti mbulohet ende nga garancia jonë ${s(p.warrantyMonths)}-mujore — na shkruani shkurt problemin dhe do të organizojmë një kontroll.`;
      return `${hi(p, "sq")}Faleminderit për pyetjen. Fatkeqësisht, ${pr.sq} nuk mund të ${pr.plural ? "kthehen" : "kthehet"}. Politika jonë pranon kthime brenda ${s(p.returnWindow)} ditëve nga dorëzimi, dhe vetëm për produkte të pahapura me vulën e fabrikës të paprekur. ${reason}${warranty}`;
    },
  },
  return_eligible: {
    en: (p) =>
      `${hi(p, "en")}Good news: order #${s(p.orderId)} was delivered ${ago(n(p.days), "en")}, within our ${s(p.returnWindow)}-day return window. As long as the box is unopened with the factory seal intact, you can bring it to our store at ${s(p.storeAddress)}, or reply here and we'll arrange a courier pickup. The refund is issued within ${s(p.refundDays)} business days after we check the seal.`,
    sq: (p) =>
      `${hi(p, "sq")}Lajm i mirë: porosia #${s(p.orderId)} është dorëzuar ${ago(n(p.days), "sq")}, brenda afatit tonë prej ${s(p.returnWindow)} ditësh për kthim. Për sa kohë kutia është e pahapur dhe me vulën e fabrikës të paprekur, mund ta sillni në dyqanin tonë në ${s(p.storeAddress)}, ose na shkruani këtu dhe organizojmë marrjen me korrier. Rimbursimi bëhet brenda ${s(p.refundDays)} ditëve të punës pasi të kontrollojmë vulën.`,
  },
  return_info: {
    en: (p) =>
      `${hi(p, "en")}Our policy: returns are accepted within ${s(p.returnWindow)} days of delivery, for unopened items with the factory seal intact. Send us your order number and let us know whether the box is still sealed, and we'll check it for you.`,
    sq: (p) =>
      `${hi(p, "sq")}Sipas politikës sonë, kthimet pranohen brenda ${s(p.returnWindow)} ditëve nga dorëzimi, për produkte të pahapura me vulën e fabrikës të paprekur. Na dërgoni numrin e porosisë dhe na tregoni nëse kutia është ende e mbyllur, dhe do ta kontrollojmë për ju.`,
  },
  warranty_repair: {
    en: (p) =>
      `${hi(p, "en")}Sorry to hear about ${product(p).en}. Order #${s(p.orderId)} is covered by our ${s(p.warrantyMonths)}-month warranty (${s(p.monthsLeft)} months left). Bring it to our store at ${s(p.storeAddress)}, or reply here and we'll arrange a free courier pickup. Diagnostics usually take ${s(p.diagnostics)} business days.`,
    sq: (p) =>
      `${hi(p, "sq")}Na vjen keq për problemin me ${product(p).sqAcc}. Porosia #${s(p.orderId)} mbulohet nga garancia jonë ${s(p.warrantyMonths)}-mujore (edhe ${s(p.monthsLeft)} muaj). Sillni produktin në dyqanin tonë në ${s(p.storeAddress)}, ose na shkruani këtu dhe organizojmë marrjen falas me korrier. Diagnostikimi zakonisht zgjat ${s(p.diagnostics)} ditë pune.`,
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
  store_info: {
    en: () => `Our store is at ${SHOP.address}, open ${SHOP.hours.en}. You can also call us on ${SHOP.phone}.`,
    sq: () =>
      `Dyqani ynë ndodhet në ${SHOP.address} dhe është i hapur ${SHOP.hours.sq}. Mund të na telefononi edhe në ${SHOP.phone}.`,
  },
  delivery_info: {
    en: (p) =>
      `We deliver across Kosovo within ${s(p.windowMin)}–${s(p.windowMax)} days. Delivery costs €${n(p.fee).toFixed(2)} and is free on orders over €${s(p.freeOver)}. You can pay by card or cash on delivery.`,
    sq: (p) =>
      `Dërgojmë në gjithë Kosovën brenda ${s(p.windowMin)}–${s(p.windowMax)} ditëve. Dërgesa kushton ${n(p.fee).toFixed(2).replace(".", ",")} € dhe është falas për porosi mbi ${s(p.freeOver)} €. Mund të paguani me kartelë ose me para në dorë gjatë dorëzimit.`,
  },
  payment_methods: {
    en: () => "You can pay by card (online or in store), cash on delivery, or bank transfer.",
    sq: () => "Mund të paguani me kartelë (online ose në dyqan), me para në dorë gjatë dorëzimit, ose me transfertë bankare.",
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
      `${hi(p, "en")}I'm sorry — order #${s(p.orderId)} was placed ${ago(n(p.days), "en")}, well past our ${s(p.windowMin)}–${s(p.windowMax)} day delivery window. I've passed it to a colleague as a priority; they'll contact you within ${s(p.slaHours)} hours to agree the next step with you.`,
    sq: (p) =>
      `${hi(p, "sq")}Na vjen keq — porosia #${s(p.orderId)} është bërë ${ago(n(p.days), "sq")}, shumë përtej afatit tonë prej ${s(p.windowMin)}–${s(p.windowMax)} ditësh. Ia kalova me prioritet një kolegu, i cili do t'ju kontaktojë brenda ${s(p.slaHours)} orëve për të vendosur bashkë hapin e radhës.`,
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
        ? "You're welcome! If you need anything else — an order, a return, warranty or delivery — just write here."
        : "Hi! I'm the Rrufe Electronics support assistant. I can check where an order is, explain returns and warranty, or answer delivery and payment questions. What can I help you with?",
    sq: (p) =>
      p.variant === "thanks"
        ? "S'ka përse! Nëse keni nevojë për diçka tjetër — porosi, kthim, garanci apo dërgesë — na shkruani këtu."
        : "Përshëndetje! Jam asistenti i mbështetjes së Rrufe Electronics. Mund ta kontrolloj ku është porosia juaj, t'ju shpjegoj kthimet dhe garancinë, ose t'ju përgjigjem për dërgesën dhe pagesat. Si mund t'ju ndihmoj?",
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
