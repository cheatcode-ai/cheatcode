'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { BillingPricingSection } from '@/components/billing/billing-pricing-section';
import { CreditMeter } from '@/components/billing/CreditMeter';
import { DeploymentMeter } from '@/components/billing/DeploymentMeter';


import { useAuth } from '@clerk/nextjs';
import { Skeleton } from '@/components/ui/skeleton';
import { useSubscription } from '@/hooks/react-query';
import { useBilling } from '@/contexts/BillingContext';
import Link from 'next/link';
import { OpenInNewWindowIcon } from '@radix-ui/react-icons';

type Props = {
  accountId: string;
  returnUrl: string;
};

export default function AccountBillingStatus({ accountId, returnUrl }: Props) {
  const { isLoaded } = useAuth();
  const authLoading = !isLoaded;
  const [error, setError] = useState<string | null>(null);

  const {
    data: subscriptionData,
    isLoading,
    error: subscriptionQueryError,
  } = useSubscription();
  
  // Get credit information from billing context
  const {
    creditsRemaining,
    creditsTotal,
    planName: billingPlanName,
    isLoading: billingLoading
  } = useBilling();





  // Show loading state
  if (isLoading || authLoading || billingLoading) {
    return (
      <div className="rounded-xl shadow-sm bg-card p-6 border-0">
        <h2 className="text-xl font-semibold mb-4">Billing & Credits</h2>
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  // Show error state
  if (error || subscriptionQueryError) {
    return (
      <div className="rounded-xl shadow-sm bg-card p-6 border-0">
        <h2 className="text-xl font-semibold mb-4">Billing & Credits</h2>
        <div className="p-4 mb-4 bg-destructive/10 border border-destructive/20 rounded-lg text-center">
          <p className="text-sm text-destructive">
            Error loading billing status:{' '}
            {error || subscriptionQueryError.message}
          </p>
        </div>
      </div>
    );
  }

  const isPlan = (planId?: string) => {
    return subscriptionData?.plan_name === planId;
  };

  const planName = isPlan('free')
    ? 'Free'
    : isPlan('base')
      ? 'Pro'
      : isPlan('extra')
        ? 'Enterprise'
        : 'Unknown';

  return (
    <div className="rounded-xl shadow-sm bg-card p-6 border-0">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Billing & Credits</h2>
        <Button variant='outline' asChild className='text-sm'>
          <Link href="/settings/usage-logs">
            Usage logs
          </Link>
        </Button>
      </div>

      {subscriptionData ? (
        <>

          {/* Add CreditMeter and DeploymentMeter Components */}
          <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CreditMeter variant="card" showUpgradePrompt={true} />
            <DeploymentMeter variant="card" showUpgradePrompt={true} />
          </div>

          {/* Plans Comparison */}
          <BillingPricingSection returnUrl={returnUrl} showTitleAndTabs={false} insideDialog={true} />

          <div className="mt-20"></div>

        </>
      ) : (
        <>

          {/* Add CreditMeter and DeploymentMeter Components */}
          <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CreditMeter variant="card" showUpgradePrompt={true} />
            <DeploymentMeter variant="card" showUpgradePrompt={true} />
          </div>

          {/* Plans Comparison */}
          <BillingPricingSection returnUrl={returnUrl} showTitleAndTabs={false} insideDialog={true} />


        </>
      )}
    </div>
  );
}
