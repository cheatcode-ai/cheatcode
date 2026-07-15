"use client";

import type { CheatcodeUIMessage } from "@cheatcode/types";
import {
  type RefObject,
  type UIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const SCROLL_BOTTOM_THRESHOLD = 72;

export interface MessageScrollState {
  contentRef: RefObject<HTMLDivElement | null>;
  hasInitializedScrollRef: RefObject<boolean>;
  isPinnedRef: RefObject<boolean>;
  isScrollToBottomVisible: boolean;
  parentRef: RefObject<HTMLDivElement | null>;
  setIsScrollToBottomVisible: (isVisible: boolean) => void;
}

export interface MessageScrollController {
  handleScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollToBottom: () => void;
  updateScrollState: (element: HTMLDivElement) => void;
}

interface PrependAnchor {
  expectedFirstMessageId: string | null;
  scrollHeight: number;
  scrollTop: number;
}

export type OlderMessagesLoadResult =
  | { firstMessageId: string; status: "prepended" }
  | { status: "failed" | "unchanged" };

export function useMessageScrollState(): MessageScrollState {
  const parentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const hasInitializedScrollRef = useRef(false);
  const isPinnedRef = useRef(true);
  const [isScrollToBottomVisible, setIsScrollToBottomVisible] = useState(false);
  return {
    contentRef,
    hasInitializedScrollRef,
    isPinnedRef,
    isScrollToBottomVisible,
    parentRef,
    setIsScrollToBottomVisible,
  };
}

export function useMessageScrollController({
  latestMessageId,
  scrollState,
}: {
  latestMessageId: string;
  scrollState: MessageScrollState;
}): MessageScrollController {
  const { hasInitializedScrollRef, isPinnedRef, parentRef, setIsScrollToBottomVisible } =
    scrollState;
  const updateScrollState = useCallback(
    (element: HTMLDivElement) => {
      const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
      const isAwayFromBottom = remaining > SCROLL_BOTTOM_THRESHOLD;
      isPinnedRef.current = !isAwayFromBottom;
      setIsScrollToBottomVisible(isAwayFromBottom);
    },
    [isPinnedRef, setIsScrollToBottomVisible],
  );
  const scrollToBottom = useCallback(() => {
    const element = parentRef.current;
    if (!element) {
      return;
    }
    hasInitializedScrollRef.current = true;
    isPinnedRef.current = true;
    element.scrollTop = element.scrollHeight;
    setIsScrollToBottomVisible(false);
  }, [hasInitializedScrollRef, isPinnedRef, parentRef, setIsScrollToBottomVisible]);
  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (hasInitializedScrollRef.current) {
        updateScrollState(event.currentTarget);
      }
    },
    [hasInitializedScrollRef, updateScrollState],
  );
  useContentResizeScrollSync({ latestMessageId, scrollState, scrollToBottom, updateScrollState });
  return { handleScroll, scrollToBottom, updateScrollState };
}

function useContentResizeScrollSync({
  latestMessageId,
  scrollState,
  scrollToBottom,
  updateScrollState,
}: {
  latestMessageId: string;
  scrollState: MessageScrollState;
  scrollToBottom: () => void;
  updateScrollState: (element: HTMLDivElement) => void;
}) {
  const { contentRef, hasInitializedScrollRef, isPinnedRef, parentRef } = scrollState;
  useEffect(() => {
    const element = parentRef.current;
    const content = contentRef.current;
    if (!latestMessageId || !element || !content) {
      return;
    }
    const syncAfterMeasurement = () => {
      if (!hasInitializedScrollRef.current || isPinnedRef.current) {
        scrollToBottom();
      } else {
        updateScrollState(element);
      }
    };
    const observer = new ResizeObserver(syncAfterMeasurement);
    observer.observe(content);
    const frame = requestAnimationFrame(syncAfterMeasurement);
    const fallback = window.setTimeout(() => {
      if (!hasInitializedScrollRef.current) {
        hasInitializedScrollRef.current = true;
        updateScrollState(element);
      }
    }, 250);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
      observer.disconnect();
    };
  }, [
    contentRef,
    hasInitializedScrollRef,
    isPinnedRef,
    latestMessageId,
    parentRef,
    scrollToBottom,
    updateScrollState,
  ]);
}

export function useOlderMessagesAnchor({
  isLoading,
  messages,
  onLoad,
  scrollState,
  updateScrollState,
}: {
  isLoading: boolean;
  messages: readonly CheatcodeUIMessage[];
  onLoad: () => Promise<OlderMessagesLoadResult>;
  scrollState: MessageScrollState;
  updateScrollState: (element: HTMLDivElement) => void;
}) {
  const anchorRef = useRef<PrependAnchor | null>(null);
  const [readyAnchor, setReadyAnchor] = useState<PrependAnchor | null>(null);
  const loadOlderMessages = useCallback(
    () =>
      loadOlderMessagesWithAnchor({
        anchorRef,
        isLoading,
        onLoad,
        parentRef: scrollState.parentRef,
        setReadyAnchor,
      }),
    [isLoading, onLoad, scrollState.parentRef],
  );
  usePrependAnchorCorrection({
    anchorRef,
    firstMessageId: messages[0]?.id ?? "",
    parentRef: scrollState.parentRef,
    readyAnchor,
    setReadyAnchor,
    updateScrollState,
  });
  return loadOlderMessages;
}

function usePrependAnchorCorrection({
  anchorRef,
  firstMessageId,
  parentRef,
  readyAnchor,
  setReadyAnchor,
  updateScrollState,
}: {
  anchorRef: RefObject<PrependAnchor | null>;
  firstMessageId: string;
  parentRef: RefObject<HTMLDivElement | null>;
  readyAnchor: PrependAnchor | null;
  setReadyAnchor: (anchor: PrependAnchor | null) => void;
  updateScrollState: (element: HTMLDivElement) => void;
}) {
  useLayoutEffect(() => {
    const anchor = readyAnchor;
    const element = parentRef.current;
    if (
      !anchor ||
      !element ||
      !anchor.expectedFirstMessageId ||
      anchor.expectedFirstMessageId !== firstMessageId
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      element.scrollTop = anchor.scrollTop + element.scrollHeight - anchor.scrollHeight;
      anchorRef.current = null;
      setReadyAnchor(null);
      updateScrollState(element);
    });
    return () => cancelAnimationFrame(frame);
  }, [anchorRef, firstMessageId, parentRef, readyAnchor, setReadyAnchor, updateScrollState]);
}

async function loadOlderMessagesWithAnchor({
  anchorRef,
  isLoading,
  onLoad,
  parentRef,
  setReadyAnchor,
}: {
  anchorRef: RefObject<PrependAnchor | null>;
  isLoading: boolean;
  onLoad: () => Promise<OlderMessagesLoadResult>;
  parentRef: RefObject<HTMLDivElement | null>;
  setReadyAnchor: (anchor: PrependAnchor | null) => void;
}): Promise<OlderMessagesLoadResult> {
  const element = parentRef.current;
  if (!element || isLoading) {
    return { status: "unchanged" };
  }
  const anchor: PrependAnchor = {
    expectedFirstMessageId: null,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  };
  anchorRef.current = anchor;
  setReadyAnchor(null);
  try {
    const result = await onLoad();
    settlePrependAnchor(result, anchor, anchorRef, setReadyAnchor);
    return result;
  } catch (error) {
    clearPrependAnchor(anchor, anchorRef, setReadyAnchor);
    throw error;
  }
}

function settlePrependAnchor(
  result: OlderMessagesLoadResult,
  anchor: PrependAnchor,
  anchorRef: RefObject<PrependAnchor | null>,
  setReadyAnchor: (anchor: PrependAnchor | null) => void,
) {
  if (anchorRef.current !== anchor) {
    return;
  }
  if (result.status === "prepended") {
    anchor.expectedFirstMessageId = result.firstMessageId;
    setReadyAnchor(anchor);
    return;
  }
  clearPrependAnchor(anchor, anchorRef, setReadyAnchor);
}

function clearPrependAnchor(
  anchor: PrependAnchor,
  anchorRef: RefObject<PrependAnchor | null>,
  setReadyAnchor: (anchor: PrependAnchor | null) => void,
) {
  if (anchorRef.current === anchor) {
    anchorRef.current = null;
    setReadyAnchor(null);
  }
}
