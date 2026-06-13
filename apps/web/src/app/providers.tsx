"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { ProfileModelSync } from "@/components/profile/profile-model-sync";
import { useAppStore } from "@/lib/store/app-store";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <NuqsAdapter>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <QueryClientProvider client={queryClient}>
          <AppStoreHydrator />
          <ProfileModelSync />
          {children}
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
