"use client";

import { useModelMenuController } from "@/components/composer/model-menu-controller";
import { ModelMenuList, ModelMenuTrigger } from "@/components/composer/model-menu-view";

interface ModelMenuProps {
  compact?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  open?: boolean | undefined;
  resolvedModelId?: null | string | undefined;
  variant?: "home" | "thread";
}

/** Selects and persists the model used for the next agent run. */
export function ModelMenu({
  compact = false,
  onOpenChange,
  open,
  resolvedModelId,
  variant = "thread",
}: ModelMenuProps) {
  const controller = useModelMenuController({ onOpenChange, open, resolvedModelId });
  return (
    <div className="relative" ref={controller.meta.menuRef}>
      <ModelMenuTrigger compact={compact} controller={controller} variant={variant} />
      {controller.state.shouldRender ? <ModelMenuList controller={controller} /> : null}
    </div>
  );
}
