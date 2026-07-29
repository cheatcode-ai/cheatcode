"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";
import { use, useEffect, useLayoutEffect, useState } from "react";
import { Toaster } from "sonner";
import { useAppStore } from "@/lib/store/app-store";
import { useChatTabsStore } from "@/lib/store/chat-tabs-store";
import { clearStreamSeqState } from "@/lib/stream/stream-seq";

const CommandPalette = dynamic(
  () => import("@/components/search/command-palette").then((module) => module.CommandPalette),
  { ssr: false },
);

interface RootSession {
  orgId: null | string;
  userId: null | string;
}

export function Providers({
  children,
  sessionPromise,
}: {
  children: ReactNode;
  sessionPromise: Promise<RootSession>;
}) {
  return (
    <NuqsAdapter>
      <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange enableSystem>
        <IdentityQueryProvider sessionPromise={sessionPromise}>{children}</IdentityQueryProvider>
      </ThemeProvider>
    </NuqsAdapter>
  );
}

function IdentityQueryProvider({
  children,
  sessionPromise,
}: {
  children: ReactNode;
  sessionPromise: Promise<RootSession>;
}) {
  const { orgId, userId } = use(sessionPromise);
  const identity = `${userId ?? "anonymous"}:${orgId ?? "personal"}`;

  return (
    <IdentityQueryBoundary key={identity} showCommandPalette={Boolean(userId)}>
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
