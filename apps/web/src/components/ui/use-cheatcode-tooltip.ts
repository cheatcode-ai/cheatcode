"use client";

import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

interface TooltipInteraction {
  destroy: () => void;
  handleFocusIn: (event: FocusEvent) => void;
  handleFocusOut: (event: FocusEvent) => void;
  handleKeyDown: (event: KeyboardEvent) => void;
  handlePointerDown: () => void;
  handlePointerEnter: (event: PointerEvent) => void;
  handlePointerLeave: () => void;
}

interface TooltipInteractionState {
  hasKeyboardFocus: boolean;
  isDismissed: boolean;
  isPointerOver: boolean;
}

interface TooltipTimers {
  clear: () => void;
  scheduleClose: () => void;
  scheduleOpen: () => void;
}

const HOVER_CLOSE_DELAY_MS = 80;
const HOVER_OPEN_DELAY_MS = 400;

let activeTooltip: { close: () => void; id: string } | null = null;

export function useCheatcodeTooltip(canOpen: boolean, id: string) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const canOpenRef = useRef(canOpen);
  const close = useCallback(() => {
    releaseActiveTooltip(id);
    setOpen(false);
  }, [id]);
  useEffect(() => {
    canOpenRef.current = canOpen;
    if (!canOpen) {
      close();
    }
  }, [canOpen, close]);
  useEffect(() => () => releaseActiveTooltip(id), [id]);
  useTooltipTriggerEvents(triggerRef, canOpenRef, id, close, setOpen, setRect);
  useTooltipGlobalDismissal(open && canOpen, close);
  useTooltipPosition(triggerRef, open && canOpen, setRect);
  return { isVisible: open && canOpen, rect, triggerRef };
}

function useTooltipTriggerEvents(
  triggerRef: RefObject<HTMLSpanElement | null>,
  canOpenRef: MutableRefObject<boolean>,
  id: string,
  close: () => void,
  setOpen: (open: boolean) => void,
  setRect: (rect: DOMRect) => void,
) {
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const interaction = createTooltipInteraction(trigger, canOpenRef, id, close, setOpen, setRect);
    return subscribeToTooltipTrigger(trigger, interaction);
  }, [canOpenRef, close, id, setOpen, setRect, triggerRef]);
}

function createTooltipInteraction(
  trigger: HTMLSpanElement,
  canOpenRef: MutableRefObject<boolean>,
  id: string,
  close: () => void,
  setOpen: (open: boolean) => void,
  setRect: (rect: DOMRect) => void,
): TooltipInteraction {
  const state: TooltipInteractionState = {
    hasKeyboardFocus: false,
    isDismissed: false,
    isPointerOver: false,
  };
  const openNow = () => {
    if (state.isDismissed || !canOpenRef.current) {
      return;
    }
    activateTooltip(id, close);
    setRect(trigger.getBoundingClientRect());
    setOpen(true);
  };
  const timers = createTooltipTimers(() => {
    if (state.isPointerOver && !state.isDismissed) {
      openNow();
    }
  }, close);
  return {
    destroy: timers.clear,
    handleFocusIn: (event) => {
      state.hasKeyboardFocus = hasVisibleKeyboardFocus(event);
      if (state.hasKeyboardFocus) {
        state.isDismissed = false;
        timers.clear();
        openNow();
      }
    },
    handleFocusOut: (event) => {
      if (!(event.relatedTarget instanceof Node) || !trigger.contains(event.relatedTarget)) {
        state.hasKeyboardFocus = false;
        if (!state.isPointerOver) {
          state.isDismissed = false;
          timers.scheduleClose();
        }
      }
    },
    handleKeyDown: (event) => {
      if (event.key === "Escape") {
        state.isDismissed = true;
        timers.clear();
        close();
      }
    },
    handlePointerDown: () => {
      state.isDismissed = true;
      timers.clear();
      close();
    },
    handlePointerEnter: (event) => {
      if (!supportsHover(event)) {
        return;
      }
      state.isPointerOver = true;
      if (!state.isDismissed) {
        timers.scheduleOpen();
      }
    },
    handlePointerLeave: () => {
      state.isPointerOver = false;
      if (!state.hasKeyboardFocus) {
        state.isDismissed = false;
        timers.scheduleClose();
      }
    },
  };
}

function createTooltipTimers(onOpen: () => void, onClose: () => void): TooltipTimers {
  let closeTimer: number | undefined;
  let openTimer: number | undefined;
  const clear = () => {
    window.clearTimeout(closeTimer);
    window.clearTimeout(openTimer);
    closeTimer = undefined;
    openTimer = undefined;
  };
  return {
    clear,
    scheduleClose: () => {
      clear();
      closeTimer = window.setTimeout(() => {
        closeTimer = undefined;
        onClose();
      }, HOVER_CLOSE_DELAY_MS);
    },
    scheduleOpen: () => {
      window.clearTimeout(closeTimer);
      closeTimer = undefined;
      if (openTimer === undefined) {
        openTimer = window.setTimeout(() => {
          openTimer = undefined;
          onOpen();
        }, HOVER_OPEN_DELAY_MS);
      }
    },
  };
}

function hasVisibleKeyboardFocus(event: FocusEvent): boolean {
  return event.target instanceof Element && event.target.matches(":focus-visible");
}

function supportsHover(event: PointerEvent): boolean {
  return event.pointerType !== "touch" && window.matchMedia("(hover: hover)").matches;
}

function subscribeToTooltipTrigger(
  trigger: HTMLSpanElement,
  interaction: TooltipInteraction,
): () => void {
  trigger.addEventListener("focusin", interaction.handleFocusIn);
  trigger.addEventListener("focusout", interaction.handleFocusOut);
  trigger.addEventListener("keydown", interaction.handleKeyDown);
  trigger.addEventListener("pointerdown", interaction.handlePointerDown);
  trigger.addEventListener("pointerenter", interaction.handlePointerEnter);
  trigger.addEventListener("pointerleave", interaction.handlePointerLeave);
  return () => {
    interaction.destroy();
    trigger.removeEventListener("focusin", interaction.handleFocusIn);
    trigger.removeEventListener("focusout", interaction.handleFocusOut);
    trigger.removeEventListener("keydown", interaction.handleKeyDown);
    trigger.removeEventListener("pointerdown", interaction.handlePointerDown);
    trigger.removeEventListener("pointerenter", interaction.handlePointerEnter);
    trigger.removeEventListener("pointerleave", interaction.handlePointerLeave);
  };
}

function activateTooltip(id: string, close: () => void) {
  if (activeTooltip?.id !== id) {
    activeTooltip?.close();
  }
  activeTooltip = { close, id };
}

function releaseActiveTooltip(id: string) {
  if (activeTooltip?.id === id) {
    activeTooltip = null;
  }
}

function useTooltipGlobalDismissal(isVisible: boolean, close: () => void) {
  useEffect(() => {
    if (!isVisible) {
      return;
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        close();
      }
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [close, isVisible]);
}

function useTooltipPosition(
  triggerRef: RefObject<HTMLSpanElement | null>,
  isVisible: boolean,
  setRect: (rect: DOMRect | null) => void,
) {
  useLayoutEffect(() => {
    if (!isVisible) {
      return;
    }
    const updatePosition = () => setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
    };
  }, [isVisible, setRect, triggerRef]);
}
