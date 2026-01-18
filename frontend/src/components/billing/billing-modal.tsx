'use client';

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { BillingPricingSection } from '@/components/billing/billing-pricing-section';


import { useAuth } from '@clerk/nextjs';
import { useSubscription } from '@/hooks/react-query/subscriptions/use-billing';
import { Skeleton } from '@/components/ui/skeleton';

interface BillingModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    returnUrl?: string;
}

export function BillingModal({ open, onOpenChange, returnUrl = window?.location?.href || '/' }: BillingModalProps) {
    const { isLoaded } = useAuth();
    const authLoading = !isLoaded;

    
    // Use the new subscription hook
    const { data: subscriptionData, isLoading, error } = useSubscription();





    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Upgrade Your Plan</DialogTitle>
                </DialogHeader>

                {isLoading || authLoading ? (
                    <div className="space-y-4">
                        <Skeleton className="h-20 w-full" />
                        <Skeleton className="h-40 w-full" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                ) : error ? (
                    <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-center">
                        <p className="text-sm text-destructive">Error loading billing status: {error.message || 'Unknown error'}</p>
                    </div>
                ) : (
                    <>
                        {subscriptionData && (
                            <div className="mb-6">
                                <div className="rounded-lg border bg-background p-4">
                                    <div className="flex justify-between items-center">
                                        <span className="text-sm font-medium text-foreground/90">
                                            Agent Usage This Month
                                        </span>
                                        <span className="text-sm font-medium">
                                            ${subscriptionData.current_usage?.toFixed(2) || '0'} /{' '}
                                            ${subscriptionData.cost_limit || '0'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        <BillingPricingSection returnUrl={returnUrl} showTitleAndTabs={false} />


                    </>
                )}
            </DialogContent>
        </Dialog>
    );
} 