import { getPersonalAccount } from '@/lib/supabase/cached-server';
import AccountBillingStatus from '@/components/billing/account-billing-status';

const returnUrl = process.env.NEXT_PUBLIC_URL as string;

// Force dynamic rendering - this page uses auth() which requires headers()
export const dynamic = 'force-dynamic';

export default async function PersonalAccountBillingPage() {
  // Use cached function - eliminates duplicate auth/DB calls across tabs
  const { account, error } = await getPersonalAccount();

  // Handle authentication and data errors
  if (error) {
    return (
      <div className="p-6">
        <div className="text-center py-8">
          <h2 className="text-lg font-semibold text-red-600">
            {error.includes('Authentication') ? 'Authentication Required' : 'Error Loading Account'}
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            {error.includes('Authentication') 
              ? 'Please sign in to view your billing information.'
              : error
            }
          </p>
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="p-6">
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
    <div>
      <AccountBillingStatus
        accountId={account.id}
        returnUrl={`${returnUrl}/settings/account`}
      />
    </div>
  );
}
