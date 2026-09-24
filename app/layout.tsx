import type { Metadata } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { AppShell } from "@/components/shell/AppShell";
import { listSenders } from "@/lib/db/repo";
import type { Sender } from "@/lib/engine/types";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Rrufe Support",
  description:
    "Customer-support agent for a Kosovo electronics shop, backed by the shop database: deterministic decisions, Jev typed proposals, and model phrasing that can't change the outcome.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  // Inbox identities come from the customers table; an unreachable database leaves the picker empty.
  let senders: Sender[] = [];
  try {
    senders = await listSenders();
  } catch (err) {
    console.error("[layout] could not load senders", err);
  }
  return (
    <html lang="en" className={`${dmSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full">
        <AppShell senders={senders}>{children}</AppShell>
      </body>
    </html>
  );
}
