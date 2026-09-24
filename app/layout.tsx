import type { Metadata } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { AppShell } from "@/components/shell/AppShell";
import { customerPersonas, listSenders, type CustomerPersona } from "@/lib/db/repo";
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const jar = await cookies();
  const initialCustomerId = jar.get("rrufe_customer_id")?.value ?? null;

  let senders: Sender[] = [];
  let personas: CustomerPersona[] = [];
  try {
    [senders, personas] = await Promise.all([listSenders(), customerPersonas()]);
  } catch (err) {
    console.error("[layout] could not load database senders/personas", err);
  }

  return (
    <html lang="en" className={`${dmSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full">
        <AppShell senders={senders} personas={personas} initialCustomerId={initialCustomerId}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
