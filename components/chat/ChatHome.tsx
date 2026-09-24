"use client";

import Link from "next/link";
import { useEffect } from "react";
import { BotIcon, ChevronRightIcon, SparkIcon } from "../icons";
import { useChat } from "../shell/ChatProvider";
import { Composer } from "./Composer";
import { AgentMessage, ErrorMessage, TypingMessage, UserMessage } from "./Messages";
import { QUESTIONS } from "./questions";

export function ChatHome() {
  const { exchanges } = useChat();
  return exchanges.length === 0 ? <Welcome /> : <Conversation />;
}

function Welcome() {
  const { prefill, findSender } = useChat();
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col px-4 pb-6 sm:px-6">
      <div className="pt-6 text-center sm:pt-8">
        <div className="relative mx-auto grid size-11 place-items-center rounded-xl border border-line bg-surface text-ink shadow-[0_2px_8px_-2px_rgba(16,24,40,0.12)]">
          <BotIcon size={20} />
          <SparkIcon size={9} className="absolute right-2 bottom-2 fill-[#4f6bff] text-[#4f6bff]" />
        </div>
        <h1 className="mt-5 text-[22px] leading-tight font-semibold tracking-tight text-ink">Hey, I&apos;m Rrufe Support.</h1>
        <p className="text-[22px] leading-tight font-medium tracking-tight text-faint">How can I help you today?</p>
      </div>

      <section aria-labelledby="questions-heading" className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="questions-heading" className="text-sm font-medium text-ink">
            Test questions
          </h2>
          <Link href="/tests" className="inline-flex items-center gap-1 text-[13px] font-medium text-ink hover:text-ink-2">
            All tests <ChevronRightIcon size={13} />
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {QUESTIONS.map((q) => {
            const sender = findSender(q.senderId);
            const Icon = q.icon;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => prefill(q.text, q.senderId)}
                className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:border-line-strong hover:shadow-[0_4px_12px_-4px_rgba(16,24,40,0.1)] focus-visible:ring-2 focus-visible:ring-ink/15 focus-visible:outline-none"
              >
                <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${q.tint}`}>
                  <Icon size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-ink">{q.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted">
                    “{q.text}” — {sender.displayName}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="mt-auto pt-10">
        <Composer />
      </div>
    </div>
  );
}

function Conversation() {
  const { exchanges, findSender } = useChat();

  useEffect(() => {
    // The composer is sticky at the bottom, so scroll the whole pane rather than an anchor behind it.
    const pane = document.getElementById("main-scroll");
    pane?.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
  }, [exchanges]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-4 sm:px-6">
      <div className="flex-1 space-y-8 pt-4 pb-8">
        {exchanges.map((ex) => {
          const sender = findSender(ex.senderId);
          return (
            <div key={ex.id} className="space-y-5">
              <UserMessage text={ex.text} sender={sender} />
              {ex.result ? (
                <AgentMessage result={ex.result} mode={ex.mode} />
              ) : ex.error ? (
                <ErrorMessage error={ex.error} />
              ) : (
                <TypingMessage />
              )}
            </div>
          );
        })}
      </div>
      <div className="sticky bottom-0 bg-surface pt-2 pb-4">
        <Composer />
      </div>
    </div>
  );
}
