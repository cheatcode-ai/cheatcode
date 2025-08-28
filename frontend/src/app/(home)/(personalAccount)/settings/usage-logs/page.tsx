import { getPersonalAccount } from '@/lib/supabase/cached-server';
import UsageLogs from '@/components/billing/usage-logs';

// Force dynamic rendering - this page uses auth() which requires headers()
export const dynamic = 'force-dynamic';

export default async function UsageLogsPage() {
  // Use cached function - eliminates duplicate auth/DB calls across tabs
  const { account, error } = await getPersonalAccount();

  // Handle authentication and data errors
  if (error) {
    return (
      <div className="space-y-6">
        <div className="text-center py-8">
          <h2 className="text-lg font-semibold text-red-600">
            {error.includes('Authentication') ? 'Authentication Required' : 'Error Loading Account'}
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            {error.includes('Authentication') 
              ? 'Please sign in to view your usage logs.'
              : error
            }
          </p>
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="space-y-6">
        <div className="text-center py-8">
          <h2 className="text-lg font-semibold text-orange-600">Account Not Found</h2>
          <p className="text-sm text-muted-foreground mt-2">
            No personal account found.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <UsageLogs accountId={account.id} />
    </div>
  );
}
