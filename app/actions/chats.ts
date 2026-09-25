"use server";

import { cookies } from "next/headers";
import { chatMessages, deleteChat, getChat, listChats, type ChatSummary, type StoredMessage } from "@/lib/db/chats";

async function viewer(): Promise<string | undefined> {
  const id = (await cookies()).get("rrufe_customer_id")?.value;
  return id === "all" || (id && /^\d{1,9}$/.test(id)) ? id : undefined;
}

async function mayOpen(id: string): Promise<boolean> {
  const who = await viewer();
  const chat = await getChat(id);
  return Boolean(chat && who && (who === "all" || chat.customerId === who));
}

export async function listMyChats(): Promise<ChatSummary[]> {
  const who = await viewer();
  return who ? listChats(who) : [];
}

export async function openChat(id: string): Promise<{ senderId: string; messages: StoredMessage[] } | null> {
  if (!(await mayOpen(id))) return null;
  const chat = (await getChat(id))!;
  return { senderId: chat.senderId, messages: await chatMessages(id) };
}

export async function removeChat(id: string): Promise<void> {
  if (await mayOpen(id)) await deleteChat(id);
}
