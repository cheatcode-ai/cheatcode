"use client";
import React from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { useModal } from '@/hooks/use-modal-store';
import { BillingPricingSection } from '../billing/billing-pricing-section';

const returnUrl = process.env.NEXT_PUBLIC_URL as string;

export const PaymentRequiredDialog = () => {
    const { isOpen, type, onClose } = useModal();
    const isModalOpen = isOpen && type === 'paymentRequiredDialog';
    
    return (
      <Dialog open={isModalOpen} onOpenChange={onClose}>
        <DialogContent className="w-[95vw] max-w-[900px] max-h-[90vh] overflow-hidden flex flex-col p-4 sm:p-6">
          <div className="w-full">
            <BillingPricingSection 
              insideDialog={true} 
              hideFree={false} 
              returnUrl={`${returnUrl}/`} 
              showTitleAndTabs={false} 
            />
          </div>
        </DialogContent>
      </Dialog>
    );
};