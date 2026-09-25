import { sqlTimestamp } from "@/lib/engine/text";
import type { ThreadMessage, TriageResult } from "@/lib/engine/types";
import { db } from "./client";

export interface ChatSummary {
  id: string;
  title: string;
  senderId: string;
  updatedAt: string;
}

export interface ChatSession extends ChatSummary {
  customerId?: string;
}

export interface StoredMessage {
  id: string;
  text: string;
  senderId: string;
  result: TriageResult;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isChatId(id: unknown): id is string {
  return typeof id === "string" && SESSION_ID.test(id);
}

function title(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

export async function createChat(input: { senderId: string; customerId?: string; firstText: string; now: Date }): Promise<string> {
  const id = crypto.randomUUID();
  const at = sqlTimestamp(input.now);
  const client = await db();
  await client.execute({
    sql: "INSERT INTO chat_sessions (session_id, sender_id, customer_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [id, input.senderId, input.customerId ? Number(input.customerId) : null, title(input.firstText), at, at],
  });
  return id;
}

export async function getChat(id: string): Promise<ChatSession | undefined> {
  if (!isChatId(id)) return undefined;
  const client = await db();
  const [row] = (await client.execute({ sql: "SELECT * FROM chat_sessions WHERE session_id = ?", args: [id] })).rows;
  if (!row) return undefined;
  return {
    id: String(row.session_id),
    title: String(row.title),
    senderId: String(row.sender_id),
    updatedAt: String(row.updated_at),
    customerId: row.customer_id === null || row.customer_id === undefined ? undefined : String(row.customer_id),
  };
}

export async function chatMessages(id: string): Promise<StoredMessage[]> {
  const chat = await getChat(id);
  if (!chat) return [];
  const client = await db();
  const rows = (await client.execute({ sql: "SELECT message_id, text, result_json FROM chat_messages WHERE session_id = ? ORDER BY message_id", args: [id] })).rows;
  return rows.map((r) => ({ id: `m${r.message_id}`, text: String(r.text), senderId: chat.senderId, result: JSON.parse(String(r.result_json)) as TriageResult }));
}

export async function chatThread(id: string): Promise<ThreadMessage[]> {
  return (await chatMessages(id)).slice(-30).map((m) => ({ senderId: m.senderId, text: m.text, decision: m.result.decision, reply: m.result.reply.text }));
}

export async function appendChatMessage(id: string, text: string, result: TriageResult, now: Date): Promise<void> {
  const client = await db();
  await client.batch(
    [
      { sql: "INSERT INTO chat_messages (session_id, text, result_json, created_at) VALUES (?, ?, ?, ?)", args: [id, text, JSON.stringify(result), sqlTimestamp(now)] },
      { sql: "UPDATE chat_sessions SET updated_at = ? WHERE session_id = ?", args: [sqlTimestamp(now), id] },
    ],
    "write",
  );
}

export async function listChats(customerId: string | "all"): Promise<ChatSummary[]> {
  const client = await db();
  const rows = (
    await client.execute(
      customerId === "all"
        ? { sql: "SELECT session_id, title, sender_id, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 50", args: [] }
        : { sql: "SELECT session_id, title, sender_id, updated_at FROM chat_sessions WHERE customer_id = ? ORDER BY updated_at DESC LIMIT 50", args: [Number(customerId)] },
    )
  ).rows;
  return rows.map((r) => ({ id: String(r.session_id), title: String(r.title), senderId: String(r.sender_id), updatedAt: String(r.updated_at) }));
}

export async function deleteChat(id: string): Promise<void> {
  if (!isChatId(id)) return;
  const client = await db();
  await client.execute({ sql: "DELETE FROM chat_sessions WHERE session_id = ?", args: [id] });
}
