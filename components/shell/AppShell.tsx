"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentType, type FormEvent, type ReactNode } from "react";
import { BookIcon, ChatIcon, FlowIcon, GearIcon, HumanIcon, PackageIcon, PlusIcon, SearchIcon, TestIcon } from "../icons";
import type { Sender } from "@/lib/engine/types";
import type { CustomerPersona } from "@/lib/db/repo";
import { ChatProvider, useChat } from "./ChatProvider";
import { UserPickerModal } from "./UserPickerModal";

type IconType = ComponentType<{ size?: number }>;

const NAV: { href: string; label: string; icon: IconType }[] = [
  { href: "/", label: "Chat", icon: ChatIcon },
  { href: "/orders", label: "Orders", icon: PackageIcon },
  { href: "/policies", label: "Policies", icon: BookIcon },
  { href: "/tests", label: "Tests", icon: TestIcon },
  { href: "/flow", label: "Decision flow", icon: FlowIcon },
  { href: "/settings", label: "Settings", icon: GearIcon },
];

export function AppShell({
  children,
  senders,
  personas = [],
  initialCustomerId = null,
}: {
  children: ReactNode;
  senders: Sender[];
  personas?: CustomerPersona[];
  initialCustomerId?: string | null;
}) {
  return (
    <ChatProvider senders={senders} personas={personas} initialCustomerId={initialCustomerId}>
      <Frame>{children}</Frame>
      <UserPickerModal />
    </ChatProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { exchanges } = useChat();
  const showGlow = pathname === "/" && exchanges.length === 0;

  return (
    <div className="flex h-dvh min-w-0 overflow-hidden bg-surface">
      <Rail pathname={pathname} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        {showGlow && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-72">
            <div className="hero-glow absolute inset-0" />
            <div className="hero-grain absolute inset-0" />
          </div>
        )}
        <TopBar />
        <main id="main-scroll" className="scroll-soft relative z-0 min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function Tooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute top-1/2 left-full z-50 ml-2 -translate-y-1/2 rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {label}
    </span>
  );
}

function Rail({ pathname }: { pathname: string }) {
  const { reset, activeCustomer, setIsUserPickerOpen } = useChat();
  const router = useRouter();
  const item =
    "group relative grid size-8 place-items-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:outline-none";

  return (
    <nav aria-label="Main" className="flex w-[52px] shrink-0 flex-col items-center border-r border-line py-3">
      <button
        type="button"
        aria-label="New chat"
        onClick={() => {
          reset();
          router.push("/");
        }}
        className={`${item} border border-line-strong text-ink-2 hover:bg-hover`}
      >
        <PlusIcon size={16} />
        <Tooltip label="New chat" />
      </button>
      <div className="mt-5 flex flex-col items-center gap-1.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={`${item} ${active ? "bg-hover text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}
            >
              <Icon size={16} />
              <Tooltip label={label} />
            </Link>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setIsUserPickerOpen(true)}
        aria-label="Switch customer account"
        className="mt-auto grid size-8 place-items-center rounded-full bg-sunken text-ink ring-1 ring-line hover:ring-line-strong hover:bg-hover transition-colors"
        title={activeCustomer ? `Active account: ${activeCustomer.name} (click to switch)` : "Choose customer account"}
      >
        {activeCustomer ? (
          <span className="text-[11px] font-semibold text-ink">
            {activeCustomer.name
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </span>
        ) : (
          <HumanIcon size={15} />
        )}
      </button>
    </nav>
  );
}

function CustomerPill() {
  const { activeCustomer, activeCustomerId, setIsUserPickerOpen } = useChat();

  if (activeCustomerId === "all") {
    return (
      <button
        type="button"
        onClick={() => setIsUserPickerOpen(true)}
        className="group flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:bg-hover transition-colors"
      >
        <span className="grid size-5 place-items-center rounded-md bg-sunken text-muted">
          <PackageIcon size={12} />
        </span>
        <span className="font-medium">All Store Orders</span>
        <span className="text-[11px] text-muted group-hover:text-ink">Switch ▾</span>
      </button>
    );
  }

  if (activeCustomer) {
    return (
      <button
        type="button"
        onClick={() => setIsUserPickerOpen(true)}
        className="group flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:bg-hover transition-colors"
      >
        <span className="grid size-5 place-items-center rounded-full bg-ink text-[10px] font-semibold text-white">
          {activeCustomer.name
            .split(" ")
            .map((p) => p[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </span>
        <span className="truncate max-w-[120px] sm:max-w-[180px] font-semibold">{activeCustomer.name}</span>
        <span className="hidden sm:inline text-muted font-normal">
          · {activeCustomer.orderCount} order{activeCustomer.orderCount === 1 ? "" : "s"}
        </span>
        <span className="text-[11px] text-muted group-hover:text-ink">Switch ▾</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsUserPickerOpen(true)}
      className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-ink text-white px-2.5 py-1.5 text-[12px] font-medium shadow-[0_1px_2px_rgba(16,24,40,0.08)] hover:bg-ink/90 transition-colors"
    >
      <HumanIcon size={13} />
      <span>Select Customer</span>
    </button>
  );
}

function TopBar() {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function search(e: FormEvent) {
    e.preventDefault();
    const q = searchRef.current?.value.trim() ?? "";
    router.push(q ? `/orders?q=${encodeURIComponent(q)}` : "/orders");
  }

  return (
    <header className="relative z-10 flex h-14 shrink-0 items-center justify-between px-3 sm:px-6">
      <CustomerPill />
      <form onSubmit={search} role="search">
        <label className="flex w-44 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] shadow-[0_1px_2px_rgba(16,24,40,0.04)] focus-within:border-line-strong sm:w-56">
          <SearchIcon size={14} className="shrink-0 text-muted" />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search orders…"
            aria-label="Search orders"
            className="min-w-0 flex-1 bg-transparent placeholder:text-faint focus:outline-none"
          />
          <kbd className="hidden shrink-0 font-sans text-[11px] font-medium text-ink-2 sm:block">⌘ K</kbd>
        </label>
      </form>
    </header>
  );
}
