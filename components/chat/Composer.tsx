"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpIcon, MicIcon } from "../icons";
import { useChat } from "../shell/ChatProvider";
import { getQuestions } from "./questions";

export function Composer() {
  const {
    draft,
    setDraft,
    send,
    busy,
    senderId,
    prefill,
    focusSignal,
    activeCustomer,
  } = useChat();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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

  const questions = useMemo(() => getQuestions(activeCustomer, senderId), [activeCustomer, senderId]);

  return (
    <div className="relative">
      {menuOpen && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md animate-rise rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-faint">Test questions</div>
          {questions.map((q) => (
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
    </div>
  );
}
