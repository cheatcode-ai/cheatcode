import { Zap } from 'lucide-react';
import { CredentialsPageClient } from './_components/credentials-page-client';

// Force dynamic rendering for consistency with other settings pages
export const dynamic = 'force-dynamic';

export default function AppProfilesPage() {
  // Removed custom_agents feature flag check - integrations are needed for coding system
  
  return (
    <div className="container mx-auto max-w-4xl px-6 py-6">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">App Profiles</h1>
              <p className="text-sm text-muted-foreground">Manage your connected app integrations</p>
            </div>
          </div>
        </div>

        {/* App Integrations - Client Component Island */}
        <CredentialsPageClient />
      </div>
    </div>
  );
} 