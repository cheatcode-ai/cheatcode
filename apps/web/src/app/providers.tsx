"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { CommandPalette } from "@/components/search/command-palette";
import { useAppStore } from "@/lib/store/app-store";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <NuqsAdapter>
      {/* Cheatcode is a light-only "Bud System" app. forcedTheme pins light regardless of
          OS/system preference — enableSystem was applying `.dark` on dark-mode machines,
          which flipped CSS vars like --background to near-black while chat text stayed
          hardcoded light, rendering Streamdown tables/code blocks dark-on-dark. */}
      <ThemeProvider attribute="class" forcedTheme="light" disableTransitionOnChange>
        <QueryClientProvider client={queryClient}>
          <AppStoreHydrator />
          {children}
          <CommandPalette />
          <Toaster />
        </QueryClientProvider>
      </ThemeProvider>
    </NuqsAdapter>
  );
}

function AppStoreHydrator() {
  useEffect(() => {
    void useAppStore.persist.rehydrate();
  }, []);

  return null;
}
