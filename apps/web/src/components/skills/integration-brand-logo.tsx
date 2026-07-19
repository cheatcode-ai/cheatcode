"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/ui/cn";

const DARK_INVERT_LOGOS = new Set(["dub", "github", "notion"]);

export function IntegrationBrandLogo({
  displayName,
  size = "card",
  slug,
}: {
  displayName: string;
  size?: "card" | "drawer" | "menu";
  slug: string;
}) {
  const [hasFailed, setHasFailed] = useState(false);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-xl",
        size === "drawer" ? "size-8" : size === "menu" ? "size-4" : "size-6",
      )}
    >
      {hasFailed ? (
        <span className="font-semibold text-[10px] text-fg-secondary">{initials(displayName)}</span>
      ) : (
        <Image
          alt=""
          aria-hidden="true"
          className={cn(
            size === "menu" ? "size-4 object-contain" : "size-5 object-contain",
            DARK_INVERT_LOGOS.has(slug) && "dark:invert",
          )}
          height={size === "menu" ? 16 : 20}
          loading="eager"
          onError={() => setHasFailed(true)}
          src={`https://logos.composio.dev/api/${slug}`}
          unoptimized
          width={size === "menu" ? 16 : 20}
        />
      )}
    </span>
  );
}

function initials(displayName: string): string {
  return (
    displayName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join("")
      .toUpperCase() || "?"
  );
}
