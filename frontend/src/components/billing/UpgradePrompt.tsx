'use client';

import React, { useState } from 'react';
import { useBilling } from '@/contexts/BillingContext';
import { usePlansQuery } from '@/hooks/react-query/billing/use-plans';
import { createDodoCheckoutSession, InsufficientCreditsError } from '@/lib/api';
import { useDodoCheckout } from '@/hooks/use-dodo-checkout';
import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertTriangle, Crown, Zap, Check, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface UpgradePromptProps {
  trigger?: React.ReactNode;
  autoOpen?: boolean;
  onClose?: () => void;
}

export function UpgradePrompt({ trigger, autoOpen = false, onClose }: UpgradePromptProps) {
  const [isOpen, setIsOpen] = useState(autoOpen);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const { getToken, isSignedIn } = useAuth();
  const { creditsRemaining, planName, isUpgradeRequired } = useBilling();
  const plansQuery = usePlansQuery();
  
  // Initialize DodoPayments overlay checkout
  const { openCheckout, isLoading: checkoutLoading } = useDodoCheckout({
    onSuccess: () => {
      toast.success('Payment successful! Your plan has been upgraded.');
      setIsOpen(false);
      onClose?.();
      // Optionally refresh billing data or redirect
      setTimeout(() => {
        window.location.href = '/dashboard?upgrade=success';
      }, 2000);
    },
    onError: (error) => {
      console.error('Checkout error:', error);
      toast.error(`Payment failed: ${error}`);
      setUpgrading(null);
    }
  });

  const handleUpgrade = async (planId: string) => {
    if (!isSignedIn) {
      toast.error('Please sign in to upgrade your plan');
      return;
    }

    try {
      setUpgrading(planId);
      
      // Use overlay checkout instead of redirect
      await openCheckout({
        planId,
        successUrl: `${window.location.origin}/dashboard?upgrade=success`,
        cancelUrl: `${window.location.origin}/dashboard?upgrade=cancelled`,
      });
      
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        toast.error('Insufficient credits to perform this action');
      } else {
        console.error('Error opening checkout:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Show specific error message for payment processing issues
        if (errorMessage.includes('Payment processing is currently unavailable')) {
          toast.error(errorMessage);
        } else {
          toast.error('Failed to start upgrade process. Please try again.');
        }
      }
      setUpgrading(null);
    }
  };

  const formatPrice = (priceINR: number, priceUSD: number) => {
    // You can add currency detection logic here
    return `₹${priceINR}/month`;
  };

  const defaultTrigger = (
    <Button variant={isUpgradeRequired ? "destructive" : "outline"} size="sm">
      {isUpgradeRequired ? (
        <>
          <AlertTriangle className="h-4 w-4 mr-2" />
          Upgrade Required
        </>
      ) : (
        <>
          <Crown className="h-4 w-4 mr-2" />
          Upgrade Plan
        </>
      )}
    </Button>
  );

  const content = (
    <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center space-x-2">
          <Crown className="h-5 w-5 text-amber-500" />
          <span>Choose Your Plan</span>
        </DialogTitle>
      </DialogHeader>
      
      <div className="space-y-4">
        {isUpgradeRequired && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center space-x-2 text-red-700">
              <AlertTriangle className="h-5 w-5" />
              <div>
                <div className="font-medium">Credits Exhausted</div>
                <div className="text-sm text-red-600">
                  You have {creditsRemaining} credits remaining. Upgrade to continue using the service.
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plansQuery.data?.plans.map((plan) => {
            const isCurrentPlan = plansQuery.data?.current_plan === plan.name.toLowerCase();
            const isPro = plan.name.toLowerCase() === 'pro';
            
            return (
              <Card 
                key={plan.name} 
                className={`relative ${isPro ? 'ring-2 ring-blue-500 shadow-lg' : ''} ${isCurrentPlan ? 'opacity-60' : ''}`}
              >
                {isPro && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <Badge className="bg-blue-500 text-white">
                      Most Popular
                    </Badge>
                  </div>
                )}
                
                <CardHeader className="text-center pb-4">
                  <CardTitle className="flex items-center justify-center space-x-2">
                    <span>{plan.name}</span>
                    {isCurrentPlan && (
                      <Badge variant="secondary">Current</Badge>
                    )}
                  </CardTitle>
                  <div className="text-3xl font-bold text-blue-600">
                    {formatPrice(plan.price_inr, plan.price_usd)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <Zap className="h-4 w-4 inline mr-1" />
                    {plan.display_credits} credits/month
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    {plan.features.map((feature, index) => (
                      <div key={index} className="flex items-start space-x-2 text-sm">
                        <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                  
                  <Button 
                    className="w-full"
                    variant={isPro ? "default" : "outline"}
                    disabled={isCurrentPlan || upgrading === plan.name.toLowerCase() || checkoutLoading}
                    onClick={() => handleUpgrade(plan.name.toLowerCase())}
                  >
                    {(upgrading === plan.name.toLowerCase() || checkoutLoading) ? (
                      <>
                        <div className="animate-spin h-4 w-4 mr-2 border-2 border-white border-t-transparent rounded-full" />
                        Upgrading...
                      </>
                    ) : isCurrentPlan ? (
                      'Current Plan'
                    ) : (
                      <>
                        Upgrade to {plan.name}
                        <ExternalLink className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="text-center text-xs text-muted-foreground mt-4">
          <p>All plans include a 30-day money-back guarantee.</p>
          <p>Credits reset monthly on your billing date.</p>
        </div>
      </div>
    </DialogContent>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (!open) onClose?.();
    }}>
      {trigger ? (
        <DialogTrigger asChild>
          {trigger}
        </DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          {defaultTrigger}
        </DialogTrigger>
      )}
      {content}
    </Dialog>
  );
}