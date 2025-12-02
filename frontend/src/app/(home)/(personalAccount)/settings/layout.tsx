import React from 'react';
import { getPersonalAccount } from '@/lib/supabase/cached-server';
import { getOpenRouterKeyStatus, getComposioProfiles } from '@/lib/supabase/settings-server';
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
  // Create a new QueryClient for this request with optimized settings
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Settings data can be cached for 2 minutes for better performance
        // while still being responsive to changes
        staleTime: 2 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnMount: true,
        refetchOnReconnect: false,
      },
    },
  });
  
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