"use client";

import { useEffect, useState } from "react";
import { CheckIcon, HumanIcon, PackageIcon, XIcon } from "../icons";
import { useChat } from "./ChatProvider";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function UserPickerModal() {
  const { personas, activeCustomerId, isUserPickerOpen, setIsUserPickerOpen, selectCustomer } = useChat();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const effectiveSelectedId =
    selectedId ?? (activeCustomerId && activeCustomerId !== "all" ? activeCustomerId : personas[0]?.id ?? "1");

  // Close on Escape only if a user is already active
  useEffect(() => {
    if (!isUserPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && activeCustomerId) {
        setIsUserPickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isUserPickerOpen, activeCustomerId, setIsUserPickerOpen]);

  if (!isUserPickerOpen) return null;

  const selectedCustomer = personas.find((p) => p.id === effectiveSelectedId) ?? personas[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3.5 sm:p-6 bg-ink/40 backdrop-blur-sm"
    >
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface shadow-2xl overflow-hidden">
        {/* Centered Header */}
        <div className="relative border-b border-line px-5 py-4 sm:px-6 text-center">
          <div className="mx-auto grid size-10 place-items-center rounded-2xl bg-sunken text-ink ring-1 ring-line mb-2">
            <HumanIcon size={20} />
          </div>
          <h2 id="user-picker-title" className="text-base font-semibold text-ink">
            Select User Account
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Choose an account to browse orders and chat as that customer:
          </p>
          {activeCustomerId && (
            <button
              type="button"
              onClick={() => setIsUserPickerOpen(false)}
              aria-label="Close dialog"
              className="absolute right-4 top-4 grid size-7 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink transition-colors"
            >
              <XIcon size={16} />
            </button>
          )}
        </div>

        {/* User account list */}
        <div className="flex-1 overflow-y-auto px-4 py-2 sm:px-5 divide-y divide-line/60">
          {personas.map((p) => {
            const isSelected = effectiveSelectedId === p.id;
            const contacts = [p.email, p.phone, p.instagram].filter(Boolean).join(" · ");

            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                onDoubleClick={() => selectCustomer(p.id)}
                className={`group flex w-full items-center justify-between gap-3 py-3 px-3 rounded-xl text-left transition-colors ${
                  isSelected ? "bg-sunken ring-1 ring-line-strong" : "hover:bg-hover/80"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 transition-colors ${
                      isSelected
                        ? "bg-ink text-white ring-ink"
                        : "bg-sunken text-ink ring-line group-hover:border-line-strong"
                    }`}
                  >
                    {initials(p.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-ink truncate">{p.name}</div>
                    <div className="text-xs text-muted truncate mt-0.5">{contacts}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="inline-flex w-24 items-center justify-center gap-1.5 rounded-lg bg-surface border border-line py-1 text-xs font-medium text-ink shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                    <PackageIcon size={12} className="text-muted shrink-0" />
                    <span>{p.orderCount} {p.orderCount === 1 ? "order" : "orders"}</span>
                  </span>

                  <div
                    className={`grid size-5 place-items-center rounded-full border transition-all ${
                      isSelected
                        ? "border-ink bg-ink text-white"
                        : "border-line bg-surface group-hover:border-line-strong"
                    }`}
                  >
                    {isSelected && <CheckIcon size={12} strokeWidth={2.6} />}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Centered Footer with "Continue as [Name]" Button */}
        <div className="flex flex-col items-center justify-center gap-2 border-t border-line bg-sunken/40 px-5 py-4 sm:px-6 text-center">
          <button
            type="button"
            onClick={() => selectCustomer(selectedCustomer?.id ?? effectiveSelectedId)}
            className="w-full sm:w-auto min-w-[260px] rounded-xl bg-ink px-6 py-2.5 text-sm font-semibold text-white shadow-[0_1px_3px_rgba(16,24,40,0.12)] hover:bg-ink/90 active:scale-[0.99] transition-all cursor-pointer"
          >
            Continue as {selectedCustomer?.name ?? "Customer"}
          </button>
          <button
            type="button"
            onClick={() => selectCustomer("all")}
            className="text-xs text-muted hover:text-ink transition-colors py-0.5 cursor-pointer"
          >
            Or continue to Store Overview (All Orders)
          </button>
        </div>
      </div>
    </div>
  );
}
