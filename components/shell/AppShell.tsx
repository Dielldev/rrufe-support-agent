"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentType, type FormEvent, type ReactNode } from "react";
import { BookIcon, ChatIcon, FlowIcon, GearIcon, HumanIcon, PackageIcon, PlusIcon, SearchIcon, TestIcon, XIcon } from "../icons";
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
  { href: "/flow", label: "Agent map", icon: FlowIcon },
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
      {pathname === "/" && <ChatHistory />}
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

function ago(sqlTime: string): string {
  const then = new Date(`${sqlTime.replace(" ", "T")}Z`).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function ChatHistory() {
  const { chats, chatId, openChat, deleteChat, reset, busy } = useChat();
  return (
    <aside aria-label="Chat history" className="hidden w-60 shrink-0 flex-col border-r border-line md:flex">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <span className="text-[13px] font-semibold text-ink">Chats</span>
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted transition hover:bg-hover hover:text-ink disabled:opacity-50"
        >
          <PlusIcon size={12} />
          New
        </button>
      </div>
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {chats.length === 0 ? (
          <p className="px-2 py-3 text-xs text-faint">Your conversations will show up here.</p>
        ) : (
          <ul className="space-y-0.5">
            {chats.map((c) => (
              <li key={c.id} className="group relative">
                <button
                  type="button"
                  onClick={() => openChat(c.id)}
                  disabled={busy}
                  aria-current={c.id === chatId ? "true" : undefined}
                  className={`flex w-full items-center gap-2 rounded-lg py-2 pr-8 pl-2.5 text-left text-[13px] transition ${
                    c.id === chatId ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover/70 hover:text-ink"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-[11px] text-faint group-hover:opacity-0">{ago(c.updatedAt)}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete chat: ${c.title}`}
                  onClick={() => deleteChat(c.id)}
                  className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted opacity-0 transition group-hover:opacity-100 hover:bg-surface hover:text-ink focus-visible:opacity-100"
                >
                  <XIcon size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
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
