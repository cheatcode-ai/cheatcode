"use client";
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Zap } from 'lucide-react';
import { useModal } from '@/hooks/use-modal-store';
import { BillingPricingSection } from '../billing/billing-pricing-section';

const returnUrl = process.env.NEXT_PUBLIC_URL as string;

export const PaymentRequiredDialog = () => {
    const { isOpen, type, onClose } = useModal();
    const isModalOpen = isOpen && type === 'paymentRequiredDialog';
    
    return (
      <Dialog open={isModalOpen} onOpenChange={onClose}>
        <DialogContent className="w-[95vw] max-w-[900px] max-h-[90vh] overflow-hidden flex flex-col p-0">
            <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 border-b flex-shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <DialogTitle>
                Upgrade Required
              </DialogTitle>
              <DialogDescription>
                You've reached your plan's usage limit. Upgrade to continue enjoying our premium features.
              </DialogDescription>
            </DialogHeader>
            
            <div className="flex-1 pb-2 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent px-4 sm:px-6 min-h-0">
              <div className="space-y-4 sm:space-y-6 pb-4">
                <div className="flex items-start p-3 sm:p-4 bg-destructive/10 border border-destructive/40 rounded-md">
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 mt-0.5">
                      <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-destructive" />
                    </div>
                    <div className="text-xs sm:text-sm min-w-0">
                      <p className="font-medium text-destructive">Usage Limit Reached</p>
                      <p className="text-destructive break-words">
                        Your current plan has been exhausted for this billing period.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="w-full">
                  <BillingPricingSection 
                    insideDialog={true} 
                    hideFree={false} 
                    returnUrl={`${returnUrl}/`} 
                    showTitleAndTabs={false} 
                  />
                </div>
              </div>
            </div>
        </DialogContent>
      </Dialog>
    );
};