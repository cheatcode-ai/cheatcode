'use client';

import { useState } from 'react';
import { BillingPricingSection } from '@/components/billing/billing-pricing-section';
import { CreditMeter } from '@/components/billing/CreditMeter';
import { DeploymentMeter } from '@/components/billing/DeploymentMeter';
import { useAuth } from '@clerk/nextjs';
import { Skeleton } from '@/components/ui/skeleton';
import { useSubscription } from '@/hooks/react-query';
import { useBilling } from '@/contexts/BillingContext';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';

type Props = {
  accountId: string;
  returnUrl: string;
};

type Tab = 'Usage' | 'Plans';

export default function AccountBillingStatus({ accountId: _accountId, returnUrl }: Props) {
  const { isLoaded } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('Usage');

  const {
    isLoading,
  } = useSubscription();
  
  const { isLoading: billingLoading } = useBilling();

  if (isLoading || !isLoaded || billingLoading) {
    return (
      <div className="max-w-3xl mx-auto p-12 space-y-8">
        <Skeleton className="h-32 w-full rounded-3xl bg-zinc-900/50" />
        <Skeleton className="h-32 w-full rounded-3xl bg-zinc-900/50" />
      </div>
    );
  }

  return (
    <div className="text-zinc-200">
      <div className={cn(
        "mx-auto transition-all duration-500 ease-in-out",
        activeTab === 'Plans' ? "max-w-7xl" : "max-w-3xl"
      )}>
        
        {/* Minimal Header & Tabs */}
        <div className="flex flex-col items-center mb-10 space-y-6">
            <h1 className="text-2xl font-medium tracking-tight text-white">Account</h1>
            
            <div className="flex items-center gap-1 p-1 bg-zinc-900/50 rounded-full border border-zinc-800/50 backdrop-blur-sm">
                {(['Usage', 'Plans'] as const).map((tab) => (
                    <button 
                        key={tab} 
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                            "relative px-6 py-2 text-sm font-medium transition-colors rounded-full z-10",
                            activeTab === tab 
                                ? "text-black dark:text-black" 
                                : "text-zinc-500 hover:text-zinc-300"
                        )}
                    >
                        {activeTab === tab && (
                            <motion.div 
                                layoutId="activeTab"
                                className="absolute inset-0 bg-white rounded-full z-[-1]"
                                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                            />
                        )}
                        {tab}
                    </button>
                ))}
            </div>
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
            {activeTab === 'Usage' && (
                <motion.div 
                    key="usage"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="space-y-8"
                >
                    <CreditMeter variant="card" showUpgradePrompt={true} />
                    <DeploymentMeter variant="card" showUpgradePrompt={true} />
                </motion.div>
            )}

            {activeTab === 'Plans' && (
                <motion.div 
                    key="plans"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                >
                    <BillingPricingSection returnUrl={returnUrl} showTitleAndTabs={false} insideDialog={true} />
                </motion.div>
            )}
        </AnimatePresence>
      </div>
    </div>
  );
}