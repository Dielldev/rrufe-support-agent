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
  return `${language === "sq" ? "U krye!" : "Done!"} ${done} ${rest}`;
}
