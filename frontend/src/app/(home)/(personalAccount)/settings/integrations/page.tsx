import { Zap } from 'lucide-react';
import { CredentialsPageClient } from '@/app/(home)/settings/credentials/_components/credentials-page-client';

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      {/* App Integrations - Client Component Island (no outer wrapper/header) */}
      <CredentialsPageClient />
    </div>
  );
}
