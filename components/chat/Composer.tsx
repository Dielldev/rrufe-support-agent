"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { SENDERS } from "@/lib/data/customers";
import { ArrowUpIcon, ChannelIcon, ChevronIcon, FlowIcon, MicIcon, SlidersIcon } from "../icons";
import { useChat } from "../shell/ChatProvider";
import { QUESTIONS } from "./questions";

const CHANNEL = { email: "Email", instagram: "Instagram", viber: "Viber" } as const;

export function Composer() {
  const { draft, setDraft, send, busy, senderId, setSenderId, mode, setMode, prefill, focusSignal } = useChat();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const sender = SENDERS.find((s) => s.id === senderId)!;
  const canSend = draft.trim().length > 0 && !busy;

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusSignal]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") setMenuOpen(false);
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      setMenuOpen(false);
      send();
    }
  }

  return (
    <div className="relative">
      {menuOpen && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md animate-rise rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-faint">Test questions</div>
          {QUESTIONS.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => {
                prefill(q.text, q.senderId);
                setMenuOpen(false);
              }}
              className="flex w-full items-baseline gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-hover"
            >
              <span className="shrink-0 font-medium text-ink">{q.title}</span>
              <span className="truncate text-muted">{q.text}</span>
            </button>
          ))}
        </div>
      )}

      <div className="relative z-10 rounded-xl border border-line bg-surface shadow-[0_1px_3px_rgba(16,24,40,0.05)] transition-colors focus-within:border-line-strong">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setMenuOpen(e.target.value === "/");
          }}
          onKeyDown={onKeyDown}
          rows={3}
          maxLength={1000}
          placeholder="How can I help you today"
          aria-label="Message"
          className="block max-h-48 min-h-[76px] w-full resize-none bg-transparent px-3.5 pt-3 text-[14px] leading-6 placeholder:text-faint focus:outline-none"
        />
        <div className="flex items-center justify-between px-2.5 pt-1 pb-2.5">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Insert a test question"
            aria-expanded={menuOpen}
            title="Test questions"
            className="grid size-6 place-items-center rounded-md text-[13px] font-medium text-muted hover:bg-hover hover:text-ink"
          >
            /
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled
              title="Voice input isn't part of this demo"
              aria-label="Voice input (unavailable)"
              className="grid size-7 place-items-center rounded-md border border-line text-muted shadow-[0_1px_2px_rgba(16,24,40,0.05)] disabled:cursor-not-allowed"
            >
              <MicIcon size={14} />
            </button>
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              aria-label="Send"
              className="grid size-7 place-items-center rounded-md bg-ink text-white transition-colors disabled:bg-sunken disabled:text-faint"
            >
              <ArrowUpIcon size={14} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>

      <div className="mx-3 flex items-center gap-2 rounded-b-xl bg-sunken px-3 py-2 text-[13px]">
        <ChannelIcon channel={sender.channel} size={14} className="shrink-0 text-muted" />
        <label className="relative flex min-w-0 items-center">
          <span className="sr-only">Send as</span>
          <select
            value={senderId}
            onChange={(e) => setSenderId(e.target.value)}
            className="max-w-[260px] min-w-0 appearance-none truncate bg-transparent pr-5 font-medium text-ink focus:outline-none"
          >
            {SENDERS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName} · {CHANNEL[s.channel]} {s.handle}
              </option>
            ))}
          </select>
          <ChevronIcon size={12} className="pointer-events-none absolute right-0 text-muted" />
        </label>
        <div className="ml-auto flex items-center gap-1">
          {mode === "stress" && <span className="mr-1 text-xs font-medium text-ink-2">Stress test on</span>}
          <button
            type="button"
            onClick={() => setMode(mode === "stress" ? "standard" : "stress")}
            aria-pressed={mode === "stress"}
            title="Stress test: swap in an overconfident decision model and a rogue phrasing model"
            className={`grid size-7 place-items-center rounded-md transition-colors ${
              mode === "stress" ? "bg-ink text-white" : "text-muted hover:bg-hover hover:text-ink"
            }`}
          >
            <SlidersIcon size={15} />
          </button>
          <Link
            href="/flow"
            title="How decisions are made"
            aria-label="Decision flow"
            className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink"
          >
            <FlowIcon size={15} />
          </Link>
        </div>
      </div>
    </div>
  );
}
