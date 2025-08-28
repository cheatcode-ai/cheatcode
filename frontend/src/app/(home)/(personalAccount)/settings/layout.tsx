import React from 'react';
import { getPersonalAccount } from '@/lib/supabase/cached-server';
import { getOpenRouterKeyStatus, getPipedreamProfiles } from '@/lib/supabase/settings-server';
import { SettingsMenuBar } from '@/components/settings/SettingsMenuBar';
import { SettingsErrorBoundary } from '@/components/settings/SettingsErrorBoundary';
import { ModalProviders } from '@/providers/modal-providers';

import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';
import { settingsKeys } from '@/hooks/react-query/settings/keys';

// Force dynamic rendering - this layout uses auth() which requires headers()
export const dynamic = 'force-dynamic';

export default async function PersonalAccountSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Create a new QueryClient for this request
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // CACHING DISABLED FOR BETTER RESPONSIVENESS
        staleTime: 0,
        gcTime: 0,
        refetchOnWindowFocus: false,
        refetchOnMount: true,
        refetchOnReconnect: false,
      },
    },
  });

  // SERVER-SIDE PREFETCHING DISABLED FOR BUTTON RESPONSIVENESS
  console.log('[Settings] Server-side prefetching DISABLED - using client-side only');
  
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