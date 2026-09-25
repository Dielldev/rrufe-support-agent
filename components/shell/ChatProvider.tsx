"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProgressEvent, RunMode, Sender, ThreadMessage, TriageResult } from "@/lib/engine/types";
import type { CustomerPersona } from "@/lib/db/repo";
import { setActiveCustomer as setCookieCustomer } from "@/app/actions/user";
import { SCENARIOS } from "@/lib/scenarios";

export interface ProgressStep {
  id: string;
  label: string;
  status: "active" | "done" | "blocked" | "failed";
}

export interface Exchange {
  id: string;
  text: string;
  senderId: string;
  mode: RunMode;
  result?: TriageResult;
  error?: string;
  /** Live "thinking" steps while the reply is being prepared (kept afterwards, collapsed). */
  steps?: ProgressStep[];
  /** Reply text streamed so far; every sentence already passed the output checks. */
  partial?: string;
  startedAt?: number;
  elapsedMs?: number;
}

interface ChatContextValue {
  /** Inbox identities from the customers table (plus unknown senders seen before). */
  senders: Sender[];
  findSender: (id: string) => Sender;
  personas: CustomerPersona[];
  activeCustomerId: string | null;
  activeCustomer: CustomerPersona | undefined;
  isUserPickerOpen: boolean;
  setIsUserPickerOpen: (open: boolean) => void;
  selectCustomer: (id: string | null) => Promise<void>;
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

/**
 * Streaming variant: calls `onEvent` for every progress event as it arrives and
 * resolves with the final result.
 */
export async function triageStream(
  text: string,
  senderId: string,
  mode: RunMode,
  thread: ThreadMessage[],
  onEvent: (e: ProgressEvent) => void,
): Promise<TriageResult> {
  const res = await fetch("/api/triage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, senderId, mode, thread, record: true, stream: true }),
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let result: TriageResult | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
      if (!line) continue;
      const msg = JSON.parse(line) as ProgressEvent | { type: "result"; result: TriageResult } | { type: "error"; error: string };
      if (msg.type === "result") result = msg.result;
      else if (msg.type === "error") throw new Error(msg.error);
      else onEvent(msg);
    }
    if (done) break;
  }
  if (!result) throw new Error("The reply stream ended early.");
  return result;
}

function applyEvent(ex: Exchange, e: ProgressEvent): Exchange {
  if (e.type === "text") return { ...ex, partial: (ex.partial ?? "") + e.delta };
  if (e.type === "text-reset") return { ...ex, partial: undefined };
  const steps = ex.steps ?? [];
  const i = steps.findIndex((s) => s.id === e.id);
  const step = { id: e.id, label: e.label, status: e.status };
  return { ...ex, steps: i >= 0 ? steps.map((s, j) => (j === i ? step : s)) : [...steps, step] };
}

export function ChatProvider({
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
  const [activeCustomerId, setActiveCustomerIdState] = useState<string | null>(initialCustomerId);
  // Show modal if user has never selected a customer account yet
  const [isUserPickerOpen, setIsUserPickerOpen] = useState(!initialCustomerId);

  const activeCustomer = useMemo(
    () => (activeCustomerId ? personas.find((p) => p.id === activeCustomerId) : undefined),
    [personas, activeCustomerId],
  );

  const findPrimarySender = useCallback(
    (customerId: string | null) => {
      if (!customerId || customerId === "all") return SCENARIOS[0].senderId;
      const s = senders.find((s) => s.customerId === customerId);
      return s ? s.id : SCENARIOS[0].senderId;
    },
    [senders],
  );

  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [senderId, setSenderId] = useState(() => findPrimarySender(initialCustomerId));
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

  const reset = useCallback(() => {
    commit([]);
    setDraft("");
    setFocusSignal((n) => n + 1);
  }, []);

  const selectCustomer = useCallback(
    async (customerId: string | null) => {
      setActiveCustomerIdState(customerId);
      const nextSender = findPrimarySender(customerId);
      setSenderId(nextSender);
      reset();
      setIsUserPickerOpen(false);
      await setCookieCustomer(customerId);
    },
    [findPrimarySender, reset],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const thread: ThreadMessage[] = history.current
      .filter((e) => e.result)
      .map((e) => ({ senderId: e.senderId, text: e.text, decision: e.result!.decision, reply: e.result!.reply.text }));
    const id = crypto.randomUUID();
    const startedAt = Date.now();
    commit([...history.current, { id, text, senderId, mode, startedAt, steps: [] }]);
    setDraft("");
    setBusy(true);
    const update = (fn: (e: Exchange) => Exchange) => commit(history.current.map((e) => (e.id === id ? fn(e) : e)));
    let patch: Partial<Exchange>;
    try {
      const result = await triageStream(text, senderId, mode, thread, (ev) => update((ex) => applyEvent(ex, ev)));
      patch = { result, partial: undefined, elapsedMs: Date.now() - startedAt };
      update((e) => ({ ...e, steps: e.steps?.map((st) => (st.status === "active" ? { ...st, status: "done" as const } : st)) }));
    } catch (err) {
      patch = { error: err instanceof Error ? err.message : "Something went wrong", partial: undefined };
    }
    update((e) => ({ ...e, ...patch }));
    setBusy(false);
    setFocusSignal((n) => n + 1);
  }, [draft, busy, senderId, mode]);

  const value = useMemo(
    () => ({
      senders,
      findSender,
      personas,
      activeCustomerId,
      activeCustomer,
      isUserPickerOpen,
      setIsUserPickerOpen,
      selectCustomer,
      exchanges,
      busy,
      draft,
      setDraft,
      senderId,
      setSenderId,
      mode,
      setMode,
      prefill,
      focusSignal,
      send,
      reset,
    }),
    [
      senders,
      findSender,
      personas,
      activeCustomerId,
      activeCustomer,
      isUserPickerOpen,
      setIsUserPickerOpen,
      selectCustomer,
      exchanges,
      busy,
      draft,
      senderId,
      mode,
      prefill,
      focusSignal,
      send,
      reset,
    ],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside <ChatProvider>");
  return ctx;
}
