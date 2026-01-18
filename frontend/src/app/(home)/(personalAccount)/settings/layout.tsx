import React from 'react';
import { SettingsMenuBar } from '@/components/settings/SettingsMenuBar';
import { SettingsErrorBoundary } from '@/components/settings/SettingsErrorBoundary';
import { ModalProviders } from '@/providers/modal-providers';

// Force dynamic rendering - this layout uses auth() which requires headers()
export const dynamic = 'force-dynamic';

export default async function PersonalAccountSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Note: Removed per-request QueryClient creation that was causing cache inconsistency.
  // The global QueryClient from ReactQueryProvider is used instead.
  return (
    <>
      <div className="min-h-screen text-zinc-200 -mt-6 pt-16">
        <div className="w-full max-w-7xl mx-auto px-6 py-12">
          {/* Menu Bar - Client Component for interactivity */}
          <div className="flex justify-center mb-16">
            <SettingsMenuBar />
          </div>

          {/* Content */}
          <div className="w-full">
            <SettingsErrorBoundary>
              {children}
            </SettingsErrorBoundary>
          </div>
        </div>
      </div>

      {/* Modal Providers for upgrade dialogs */}
      <ModalProviders />
    </>
  );
}