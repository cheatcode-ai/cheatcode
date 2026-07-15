import Image from "next/image";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";

export type ProviderMarkKind = "anthropic" | "auto" | "deepseek" | "openai";

const IMAGE_PROVIDER_MARKS = {
  deepseek: {
    alt: "DeepSeek",
    src: "/provider-icons/deepseek-color.png",
  },
} as const satisfies Record<
  Exclude<ProviderMarkKind, "anthropic" | "auto" | "openai">,
  { alt: string; src: string }
>;

export function ProviderMark({
  className,
  provider,
}: {
  className?: string | undefined;
  provider: ProviderMarkKind;
}) {
  if (provider === "auto") {
    return <CheatcodeMark aria-hidden="true" className={className} />;
  }
  if (provider === "anthropic") {
    return <AnthropicMark aria-hidden="true" className={className} />;
  }
  if (provider === "openai") {
    return <OpenAiMark aria-hidden="true" className={className} />;
  }
  const mark = IMAGE_PROVIDER_MARKS[provider];
  return (
    <Image
      aria-hidden="true"
      alt=""
      className={className}
      fetchPriority="high"
      height={20}
      priority
      src={mark.src}
      title={mark.alt}
      unoptimized
      width={20}
    />
  );
}

function OpenAiMark({ className }: { className?: string | undefined }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>OpenAI</title>
      <path d="M22.28 9.82a5.98 5.98 0 0 0 -0.52 -4.91 6.05 6.05 0 0 0 -6.51 -2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0 -4 2.9 6.05 6.05 0 0 0 0.74 7.1 5.98 5.98 0 0 0 0.51 4.91 6.05 6.05 0 0 0 6.51 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77 -4.21 5.99 5.99 0 0 0 4 -2.9 6.06 6.06 0 0 0 -0.75 -7.07zm-9.02 12.61a4.48 4.48 0 0 1 -2.88 -1.04l0.14 -0.08 4.78 -2.76a0.79 0.79 0 0 0 0.39 -0.68v-6.74l2.02 1.17a0.07 0.07 0 0 1 0.04 0.05v5.58a4.5 4.5 0 0 1 -4.49 4.49zm-9.66 -4.13a4.47 4.47 0 0 1 -0.53 -3.01l0.14 0.09 4.78 2.76a0.77 0.77 0 0 0 0.78 0l5.84 -3.37v2.33a0.08 0.08 0 0 1 -0.03 0.06L9.74 19.95a4.5 4.5 0 0 1 -6.14 -1.65zM2.34 7.9a4.49 4.49 0 0 1 2.37 -1.97V11.6a0.77 0.77 0 0 0 0.39 0.68l5.81 3.35 -2.02 1.17a0.08 0.08 0 0 1 -0.07 0l-4.83 -2.79A4.5 4.5 0 0 1 2.34 7.87zm16.6 3.86L13.1 8.36 15.12 7.2a0.08 0.08 0 0 1 0.07 0l4.83 2.79a4.49 4.49 0 0 1 -0.68 8.1v-5.68a0.79 0.79 0 0 0 -0.41 -0.67zm2.01 -3.02l-0.14 -0.09 -4.77 -2.78a0.78 0.78 0 0 0 -0.79 0L9.41 9.23V6.9a0.07 0.07 0 0 1 0.03 -0.06l4.83 -2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86l-2.02 -1.16a0.08 0.08 0 0 1 -0.04 -0.06V6.07a4.5 4.5 0 0 1 7.38 -3.45l-0.14 0.08L8.7 5.46a0.79 0.79 0 0 0 -0.39 0.68zm1.1 -2.37l2.6 -1.5 2.61 1.5v3l-2.6 1.5 -2.61 -1.5Z" />
    </svg>
  );
}

function AnthropicMark({ className }: { className?: string | undefined }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Claude</title>
      <path
        d="m4.71 15.96 4.72 -2.65 0.08 -0.23 -0.08 -0.13h-0.23l-0.79 -0.05 -2.7 -0.07 -2.34 -0.1 -2.26 -0.12 -0.57 -0.12 -0.53 -0.7 0.05 -0.35 0.48 -0.32 0.69 0.06 1.52 0.1 2.28 0.16 1.65 0.1 2.45 0.26h0.39l0.05 -0.16 -0.13 -0.1 -0.1 -0.1L6.97 9.84l-2.55 -1.69 -1.34 -0.97 -0.72 -0.49 -0.36 -0.46 -0.16 -1.01 0.66 -0.72 0.88 0.06 0.22 0.06 0.89 0.69 1.91 1.48 2.49 1.83 0.36 0.3 0.15 -0.1 0.02 -0.07 -0.16 -0.27 -1.35 -2.45 -1.44 -2.49 -0.64 -1.03 -0.17 -0.62c-0.06 -0.25 -0.1 -0.47 -0.1 -0.73L6.29 0.13 6.7 0l1 0.13 0.42 0.36 0.62 1.41 1 2.23 1.55 3.03 0.46 0.9 0.24 0.83 0.09 0.26h0.16v-0.15l0.13 -1.71 0.24 -2.09 0.23 -2.7 0.08 -0.76 0.38 -0.91 0.75 -0.49 0.58 0.28 0.48 0.69 -0.07 0.44 -0.29 1.85 -0.56 2.9 -0.36 1.94h0.21l0.24 -0.24 0.98 -1.31 1.65 -2.06 0.73 -0.82 0.85 -0.9 0.55 -0.43h1.03l0.76 1.13 -0.34 1.17 -1.06 1.35 -0.88 1.14 -1.26 1.7 -0.79 1.36 0.07 0.11 0.19 -0.02 2.85 -0.61 1.54 -0.28 1.84 -0.32 0.83 0.39 0.09 0.39 -0.33 0.81 -1.97 0.49 -2.31 0.46 -3.44 0.81 -0.04 0.03 0.05 0.06 1.55 0.15 0.66 0.04h1.62l3.02 0.22 0.79 0.52 0.47 0.64 -0.08 0.49 -1.21 0.62 -1.64 -0.39 -3.82 -0.91 -1.31 -0.33h-0.18v0.11l1.09 1.07 2 1.81 2.51 2.33 0.13 0.58 -0.32 0.46 -0.34 -0.05 -2.2 -1.66 -0.85 -0.75 -1.92 -1.62h-0.13v0.17l0.44 0.65 2.34 3.52 0.12 1.08 -0.17 0.35 -0.61 0.21 -0.67 -0.12 -1.37 -1.92L14.38 17.96l-1.14 -1.94 -0.14 0.08 -0.67 7.26 -0.32 0.37 -0.73 0.28 -0.61 -0.46 -0.32 -0.75 0.32 -1.48 0.39 -1.92 0.32 -1.53 0.29 -1.9 0.17 -0.63 -0.01 -0.04 -0.14 0.02 -1.43 1.97 -2.18 2.94 -1.72 1.85 -0.41 0.16 -0.72 -0.37 0.07 -0.66 0.4 -0.59 2.39 -3.04 1.44 -1.88 0.93 -1.09 -0.01 -0.16h-0.05l-6.34 4.12 -1.13 0.15 -0.49 -0.46 0.06 -0.75 0.23 -0.24 1.91 -1.31Z"
        fill="currentColor"
      />
    </svg>
  );
}
