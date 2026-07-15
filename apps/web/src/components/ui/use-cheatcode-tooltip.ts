"use client";

import {
  type MutableRefObject,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

interface TooltipInteraction {
  handleFocusIn: () => void;
  handleFocusOut: (event: FocusEvent) => void;
  handleKeyDown: (event: KeyboardEvent) => void;
  handlePointerEnter: () => void;
  handlePointerLeave: () => void;
}

export function useCheatcodeTooltip(canOpen: boolean) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const canOpenRef = useRef(canOpen);
  useEffect(() => {
    canOpenRef.current = canOpen;
  }, [canOpen]);
  useTooltipTriggerEvents(triggerRef, canOpenRef, setOpen, setRect);
  useTooltipPosition(triggerRef, open && canOpen, setRect);
  return { isVisible: open && canOpen, rect, triggerRef };
}

function useTooltipTriggerEvents(
  triggerRef: RefObject<HTMLSpanElement | null>,
  canOpenRef: MutableRefObject<boolean>,
  setOpen: (open: boolean) => void,
  setRect: (rect: DOMRect) => void,
) {
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const interaction = createTooltipInteraction(trigger, canOpenRef, setOpen, setRect);
    return subscribeToTooltipTrigger(trigger, interaction);
  }, [canOpenRef, setOpen, setRect, triggerRef]);
}

function createTooltipInteraction(
  trigger: HTMLSpanElement,
  canOpenRef: MutableRefObject<boolean>,
  setOpen: (open: boolean) => void,
  setRect: (rect: DOMRect) => void,
): TooltipInteraction {
  let hasFocus = false;
  let isDismissed = false;
  let isPointerOver = false;
  const sync = () => {
    if (!(hasFocus || isPointerOver)) {
      isDismissed = false;
      setOpen(false);
    } else if (!isDismissed && canOpenRef.current) {
      setRect(trigger.getBoundingClientRect());
      setOpen(true);
    }
  };
  return {
    handleFocusIn: () => {
      hasFocus = true;
      sync();
    },
    handleFocusOut: (event) => {
      if (!(event.relatedTarget instanceof Node) || !trigger.contains(event.relatedTarget)) {
        hasFocus = false;
        sync();
      }
    },
    handleKeyDown: (event) => {
      if (event.key === "Escape") {
        isDismissed = true;
        setOpen(false);
      }
    },
    handlePointerEnter: () => {
      isPointerOver = true;
      sync();
    },
    handlePointerLeave: () => {
      isPointerOver = false;
      sync();
    },
  };
}

function subscribeToTooltipTrigger(
  trigger: HTMLSpanElement,
  interaction: TooltipInteraction,
): () => void {
  trigger.addEventListener("focusin", interaction.handleFocusIn);
  trigger.addEventListener("focusout", interaction.handleFocusOut);
  trigger.addEventListener("keydown", interaction.handleKeyDown);
  trigger.addEventListener("pointerenter", interaction.handlePointerEnter);
  trigger.addEventListener("pointerleave", interaction.handlePointerLeave);
  return () => {
    trigger.removeEventListener("focusin", interaction.handleFocusIn);
    trigger.removeEventListener("focusout", interaction.handleFocusOut);
    trigger.removeEventListener("keydown", interaction.handleKeyDown);
    trigger.removeEventListener("pointerenter", interaction.handlePointerEnter);
    trigger.removeEventListener("pointerleave", interaction.handlePointerLeave);
  };
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
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isVisible, setRect, triggerRef]);
}
