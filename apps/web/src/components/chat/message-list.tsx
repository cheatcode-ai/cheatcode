"use client";

import type { CheatcodeUIMessage } from "@cheatcode/types";
import { useVirtualizer } from "@tanstack/react-virtual";
import Image from "next/image";
import { useEffect, useRef } from "react";
import { MessageParts } from "@/components/chat/message-parts";
import { cn } from "@/lib/ui/cn";

const LIST_TOP_PADDING = 24;
const LIST_BOTTOM_PADDING = 160;
const ESTIMATED_MESSAGE_HEIGHT = 180;

export function MessageList({ messages }: { messages: CheatcodeUIMessage[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const latestMessage = messages.at(-1);
  const latestMessageId = latestMessage?.id ?? "";
  const latestPartCount = latestMessage?.parts.length ?? 0;
  const virtualizer = useVirtualizer({
    count: messages.length,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    getItemKey: (index) => messages[index]?.id ?? index,
    getScrollElement: () => parentRef.current,
    overscan: 6,
  });

  useEffect(() => {
    const scrollKey = `${latestMessageId}:${latestPartCount}`;
    if (scrollKey.length === 0) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(Math.max(messages.length - 1, 0), {
        align: "end",
        behavior: "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [latestMessageId, latestPartCount, messages.length, virtualizer]);

  if (messages.length === 0) {
    return <EmptyThread />;
  }

  return (
    <div className="chat-scrollbar flex-1 overflow-y-auto px-4" ref={parentRef} role="log">
      <div
        className="relative mx-auto w-full max-w-3xl"
        style={{
          height: virtualizer.getTotalSize() + LIST_TOP_PADDING + LIST_BOTTOM_PADDING,
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const message = messages[virtualItem.index];
          if (!message) {
            return null;
          }
          return (
            <div
              className="absolute top-0 left-0 w-full pb-4"
              data-index={virtualItem.index}
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              style={{
                transform: `translateY(${virtualItem.start + LIST_TOP_PADDING}px)`,
              }}
            >
              <MessageBubble message={message} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyThread() {
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center bg-white px-4">
      <div className="text-center">
        <div className="mb-6 flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-[#f1f1f1] bg-[#f7f7f7]">
            <Image alt="" height={24} src="/cheatcode-symbol.png" width={24} />
          </div>
        </div>
        <h2 className="mb-2 font-semibold text-[#1b1b1b] text-[15px]">Ready to build</h2>
        <p className="mx-auto max-w-sm text-[#707070] text-[13px]">
          What would you like to create today?
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: CheatcodeUIMessage }) {
  const isUser = message.role === "user";

  return (
    <article
      className={cn(
        "group relative px-2",
        isUser ? "ms-auto w-full max-w-[78%]" : "w-full max-w-full",
      )}
    >
      <div
        className={cn(
          isUser && "rounded-[16px] bg-[var(--thread-user-message-bg)] px-4 py-3 text-[#1b1b1b]",
          !isUser && "py-1",
        )}
      >
        {isUser ? null : (
          <div className="mb-3 flex items-center gap-2 text-[13px]">
            <span className="text-[#f8af2c]">*</span>
            <span className="font-semibold text-[#1b1b1b]">cheatcode</span>
            <span className="text-[#a0a0a0]">- sonnet-4.6</span>
          </div>
        )}
        <MessageParts message={message} />
      </div>
    </article>
  );
}
