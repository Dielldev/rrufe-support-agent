import type { Language } from "@/lib/engine/types";
import type { OrderChangeDone, ToolLedger } from "./ledger";

const eur = (n: number) => `€${n.toFixed(2)}`;

function line(c: OrderChangeDone, language: Language): string {
  if (language === "sq") {
    switch (c.kind) {
      case "address":
        return `Porosia #${c.orderId} tani do të dërgohet në ${c.address}.`;
      case "remove_item":
        return `Hoqa ${c.qty}× ${c.name} nga porosia #${c.orderId}. Totali i ri është ${eur(c.totalEur)}, që paguhet në dorëzim.`;
      case "cancel":
        return `Porosia #${c.orderId} u anulua. Për të nuk është paguar asgjë.`;
    }
  }
  switch (c.kind) {
    case "address":
      return `Order #${c.orderId} will now be delivered to ${c.address}.`;
    case "remove_item":
      return `I removed ${c.qty}× ${c.name} from order #${c.orderId}. The new total is ${eur(c.totalEur)}, paid on delivery.`;
    case "cancel":
      return `Order #${c.orderId} is cancelled. Nothing has been paid for it.`;
  }
}

export function confirmChanges(ledger: ToolLedger, language: Language): string {
  const done = ledger.changes.map((c) => line(c, language)).join(" ");
  const rest = ledger.handoff
    ? language === "sq"
      ? `Për pjesën tjetër do t'ju kontaktojë një koleg brenda ${ledger.handoff.slaHours} orëve.`
      : `A colleague will get back to you about the rest within ${ledger.handoff.slaHours} hours.`
    : language === "sq"
      ? "Nëse keni pyetur edhe për diçka tjetër, ju lutem na shkruani sërish."
      : "If you asked about anything else too, please write again.";
  const sq = language === "sq";
  const opening = ledger.changes.length ? `${sq ? "U krye!" : "Done!"} ${done}` : sq ? "Na vjen keq për vonesën." : "Sorry for the delay.";
  const trace = ledger.actions.find((a) => a.kind === "carrier_trace")?.detail.match(/TRC-\d+/)?.[0];
  const traced = trace ? (sq ? `I kërkova korrierit ta gjurmojë porosinë (referenca ${trace}).` : `I've asked the courier to trace it (reference ${trace}).`) : "";
  const voucher = ledger.vouchers[0];
  const given = voucher
    ? voucher.alreadyIssued
      ? sq
        ? "Për këtë vonesë keni marrë tashmë kompensim, që e shihni më poshtë."
        : "You already received compensation for this delay; it's shown below."
      : sq
        ? "Për pritjen, më poshtë keni një kupon për porosinë e ardhshme."
        : "For the wait, there's a voucher for your next order below."
    : "";
  return [opening, traced, given, rest].filter(Boolean).join(" ");
}
