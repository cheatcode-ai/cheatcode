import React from 'react';
import { getPersonalAccount } from '@/lib/supabase/cached-server';
import { getOpenRouterKeyStatus, getPipedreamProfiles } from '@/lib/supabase/settings-server';
import { SettingsMenuBar } from '@/components/settings/SettingsMenuBar';
import { SettingsErrorBoundary } from '@/components/settings/SettingsErrorBoundary';
import { ModalProviders } from '@/providers/modal-providers';

import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';
import { settingsKeys } from '@/hooks/react-query/settings/keys';

export default async function PersonalAccountSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Create a new QueryClient for this request
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // These options match our global settings
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
      },
    },
  });

  // Prefetch all settings data and hydrate the client cache
  // This eliminates the need for client-side API calls across all tabs
  // Each prefetch is independent - failures don't break the entire layout
  
  const prefetchResults = await Promise.allSettled([
    // 1. Personal account data (billing, usage-logs) - critical
    queryClient.prefetchQuery({
      queryKey: settingsKeys.account.personal(),
      queryFn: getPersonalAccount,
      staleTime: 5 * 60 * 1000,
    }),
    
    // 2. BYOK OpenRouter key status - optional
    queryClient.prefetchQuery({
      queryKey: settingsKeys.byok.openrouter.status(),
      queryFn: getOpenRouterKeyStatus,
      staleTime: 2 * 60 * 1000,
    }),
    
    // 3. Pipedream integration profiles - optional
    queryClient.prefetchQuery({
      queryKey: settingsKeys.integrations.pipedream.profiles(),
      queryFn: getPipedreamProfiles,
      staleTime: 5 * 60 * 1000,
    }),
  ]);

  // Log prefetch results for debugging
  const [accountResult, byokResult, integrationsResult] = prefetchResults;
  console.log(`[Settings] Prefetch results:`, {
    account: accountResult.status,
    byok: byokResult.status,
    integrations: integrationsResult.status,
  });

  console.log('[Settings] Server-side prefetch completed - client cache hydrated');
  
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="space-y-6 w-full">
        <div className="w-full max-w-7xl mx-auto px-4">
          {/* Menu Bar - Client Component for interactivity */}
          <div className="flex justify-center mb-6">
            <SettingsMenuBar />
          </div>
          
          {/* Content */}
          <div className="w-full bg-card-bg dark:bg-background-secondary p-6 rounded-2xl border border-subtle dark:border-white/10 shadow-custom">
            <SettingsErrorBoundary>
              {children}
            </SettingsErrorBoundary>
          </div>
        </div>
      </div>
      
      {/* Modal Providers for upgrade dialogs */}
      <ModalProviders />
    </HydrationBoundary>
  );
}