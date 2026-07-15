"use client";

import { useAuth } from "@clerk/nextjs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useState } from "react";
import { Toaster } from "sonner";
import { useAppStore } from "@/lib/store/app-store";
import { useChatTabsStore } from "@/lib/store/chat-tabs-store";
import { clearStreamSeqState } from "@/lib/stream/stream-seq";

const CommandPalette = dynamic(
  () => import("@/components/search/command-palette").then((module) => module.CommandPalette),
  { ssr: false },
);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NuqsAdapter>
      <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange enableSystem>
        <IdentityQueryProvider>{children}</IdentityQueryProvider>
      </ThemeProvider>
    </NuqsAdapter>
  );
}

function IdentityQueryProvider({ children }: { children: ReactNode }) {
  const { isLoaded, orgId, userId } = useAuth();
  const identity = isLoaded ? `${userId ?? "anonymous"}:${orgId ?? "personal"}` : "loading";

  return (
    <IdentityQueryBoundary key={identity} showCommandPalette={Boolean(isLoaded && userId)}>
      {children}
    </IdentityQueryBoundary>
  );
}

function IdentityQueryBoundary({
  children,
  showCommandPalette,
}: {
  children: ReactNode;
  showCommandPalette: boolean;
}) {
  const [queryClient] = useState(() => new QueryClient());

  useLayoutEffect(() => {
    resetIdentityScopedState();
    return () => {
      queryClient.clear();
      resetIdentityScopedState();
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <AppStoreHydrator />
      {children}
      {showCommandPalette ? <CommandPalette /> : null}
      <Toaster />
    </QueryClientProvider>
  );
}

function AppStoreHydrator() {
  useEffect(() => {
    void useAppStore.persist.rehydrate();
  }, []);

  return null;
}

function resetIdentityScopedState(): void {
  useAppStore.getState().resetIdentityState();
  useChatTabsStore.getState().resetChatTabs();
  clearStreamSeqState();
}
