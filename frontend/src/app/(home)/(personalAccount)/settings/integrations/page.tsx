import { Zap } from 'lucide-react';
import { CredentialsPageClient } from '@/app/(home)/settings/credentials/_components/credentials-page-client';
import { RefetchControlProvider } from '@/hooks/use-refetch-control';

// Force dynamic rendering for consistency with other settings pages
export const dynamic = 'force-dynamic';

export default function IntegrationsPage() {
  return (
    <RefetchControlProvider disableRefetching={true}>
      <div className="space-y-6">
        {/* App Integrations - Client Component Island (no outer wrapper/header) */}
        <CredentialsPageClient />
      </div>
    </RefetchControlProvider>
  );
}
