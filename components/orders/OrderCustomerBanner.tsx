"use client";

import { PackageIcon } from "../icons";
import { useChat } from "../shell/ChatProvider";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function OrderCustomerBanner({
  customer,
  orderCount,
  isIsolated,
}: {
  customer?: { id: string; name: string; phone?: string; email?: string; instagram?: string };
  orderCount: number;
  isIsolated: boolean;
}) {
  const { setIsUserPickerOpen } = useChat();

  if (isIsolated && customer) {
    const contacts = [customer.email, customer.phone, customer.instagram].filter(Boolean).join(" · ");
    return (
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-sunken/50 px-4 py-3 text-[13px]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-white">
            {initials(customer.name)}
          </div>
          <div className="min-w-0">
            <span className="font-semibold text-ink">{customer.name}</span>
            <p className="text-xs text-muted truncate mt-0.5">
              {contacts} · {orderCount} {orderCount === 1 ? "order" : "orders"}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsUserPickerOpen(true)}
          className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:bg-hover transition-colors shrink-0"
        >
          Switch Account
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-sunken/40 px-4 py-3 text-[13px]">
      <div className="flex items-center gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-sunken border border-line text-muted">
          <PackageIcon size={16} />
        </div>
        <div>
          <span className="font-semibold text-ink">Store Overview (All Orders)</span>
          <p className="text-xs text-muted">
            Displaying every order across the shop database.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setIsUserPickerOpen(true)}
        className="rounded-lg border border-line-strong bg-ink text-white px-3 py-1.5 text-xs font-medium shadow-[0_1px_2px_rgba(16,24,40,0.08)] hover:bg-ink/90 transition-colors shrink-0"
      >
        Select Account
      </button>
    </div>
  );
}
