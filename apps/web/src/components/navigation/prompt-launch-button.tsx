"use client";

import { useRouter } from "next/navigation";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { toast } from "sonner";
import { createPromptHandoff } from "@/lib/input/prompt-handoff";

type PromptLaunchButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "onClick" | "type"
> & {
  children: ReactNode;
  onLaunch?: (() => void) | undefined;
  prompt: string;
  query?: Readonly<Record<string, string | undefined>> | undefined;
};

/** Navigates with an opaque, one-time session key so prompt text never enters the URL. */
export function PromptLaunchButton({
  children,
  onLaunch,
  prompt,
  query,
  ...buttonProps
}: PromptLaunchButtonProps) {
  const router = useRouter();

  return (
    <button
      {...buttonProps}
      onClick={() => {
        try {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(query ?? {})) {
            if (value) {
              params.set(key, value);
            }
          }
          params.set("promptKey", createPromptHandoff(prompt).promptKey);
          onLaunch?.();
          router.push(`/?${params.toString()}`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not open that prompt.");
        }
      }}
      type="button"
    >
      {children}
    </button>
  );
}
