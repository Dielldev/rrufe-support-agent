"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { RunMode, Sender, ThreadMessage, TriageResult } from "@/lib/engine/types";
import { SCENARIOS } from "@/lib/scenarios";

export interface Exchange {
  id: string;
  text: string;
  senderId: string;
  mode: RunMode;
  result?: TriageResult;
  error?: string;
}

interface ChatContextValue {
  /** Inbox identities from the customers table (plus unknown senders seen before). */
  senders: Sender[];
  findSender: (id: string) => Sender;
  exchanges: Exchange[];
  busy: boolean;
  draft: string;
  setDraft: (text: string) => void;
  senderId: string;
  setSenderId: (id: string) => void;
  mode: RunMode;
  setMode: (mode: RunMode) => void;
  /** Put a question in the textbox (and pick who is asking) without sending it. */
  prefill: (text: string, senderId: string) => void;
  /** Bumps whenever the composer should grab focus. */
  focusSignal: number;
  send: () => void;
  reset: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/** A sender the picker doesn't know yet (e.g. a scenario sender before the list loads). */
export function fallbackSender(id: string): Sender {
  const sep = id.indexOf(":");
  const channel = (sep > 0 ? id.slice(0, sep) : "instagram") as Sender["channel"];
  const handle = sep > 0 ? id.slice(sep + 1) : id;
  return { id, channel, handle, displayName: handle };
}

/**
 * @param record write the message and decision to the database. The chat does;
 *   the Tests page doesn't, so running the suite never changes the data it checks.
 */
export async function triage(text: string, senderId: string, mode: RunMode, thread: ThreadMessage[] = [], record = true) {
  const res = await fetch("/api/triage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, senderId, mode, thread, record }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as TriageResult;
}

export function ChatProvider({ children, senders }: { children: ReactNode; senders: Sender[] }) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [senderId, setSenderId] = useState(SCENARIOS[0].senderId);
  const findSender = useCallback((id: string) => senders.find((s) => s.id === id) ?? fallbackSender(id), [senders]);
  const [mode, setMode] = useState<RunMode>("standard");
  const [focusSignal, setFocusSignal] = useState(0);
  const history = useRef<Exchange[]>([]);

  const commit = (next: Exchange[]) => {
    history.current = next;
    setExchanges(next);
  };

  const prefill = useCallback((text: string, sender: string) => {
    setDraft(text);
    setSenderId(sender);
    setFocusSignal((n) => n + 1);
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const thread: ThreadMessage[] = history.current
      .filter((e) => e.result)
      .map((e) => ({ senderId: e.senderId, text: e.text, decision: e.result!.decision }));
    const id = crypto.randomUUID();
    commit([...history.current, { id, text, senderId, mode }]);
    setDraft("");
    setBusy(true);
    let patch: Partial<Exchange>;
    try {
      patch = { result: await triage(text, senderId, mode, thread) };
    } catch (err) {
      patch = { error: err instanceof Error ? err.message : "Something went wrong" };
    }
    commit(history.current.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    setBusy(false);
    setFocusSignal((n) => n + 1);
  }, [draft, busy, senderId, mode]);

  const reset = useCallback(() => {
    commit([]);
    setDraft("");
    setFocusSignal((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({ senders, findSender, exchanges, busy, draft, setDraft, senderId, setSenderId, mode, setMode, prefill, focusSignal, send, reset }),
    [senders, findSender, exchanges, busy, draft, senderId, mode, prefill, focusSignal, send, reset],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside <ChatProvider>");
  return ctx;
}
