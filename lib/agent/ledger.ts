import type { Order } from "@/lib/db/repo";
import type { Action, Handoff, ProgressEvent, ToolAccess, ToolTrace, VoucherCardData } from "@/lib/engine/types";

/*
 * Everything the tools did during one agent run. The ledger is filled by the
 * tools themselves (code), not by reading back what the model says it did, and
 * it is what the output checks and the final decision are based on.
 */

export type OrderChangeDone =
  | { kind: "address"; orderId: string; address: string }
  | { kind: "remove_item"; orderId: string; name: string; qty: number; totalEur: number }
  | { kind: "cancel"; orderId: string };

export class ToolLedger {
  readonly traces: ToolTrace[] = [];
  /** Raw tool outputs, in order. The only source of facts the reply may state. */
  readonly outputs: unknown[] = [];
  /** Orders the requester was allowed to read (for order cards and the audit log). */
  readonly openedOrders = new Map<string, Order>();
  readonly actions: Action[] = [];
  readonly vouchers: VoucherCardData[] = [];
  readonly changes: OrderChangeDone[] = [];
  handoff?: Handoff;
  denied = 0;

  constructor(readonly onEvent?: (e: ProgressEvent) => void) {}

  record(trace: ToolTrace, output: unknown): void {
    this.traces.push(trace);
    this.outputs.push(output);
    if (trace.access === "denied") this.denied += 1;
  }

  /** All tool output as one string, for "does the reply only use what the tools returned?" checks. */
  factText(): string {
    return this.outputs.map((o) => JSON.stringify(o)).join("\n");
  }

  accessCount(access: ToolAccess): number {
    return this.traces.filter((t) => t.access === access).length;
  }
}
