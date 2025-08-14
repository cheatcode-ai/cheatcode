'use client';

import React from 'react';
import { Progress } from '@/components/ui/progress';
import { Info, Zap, CheckCircle } from 'lucide-react';
import { useBilling } from '@/contexts/BillingContext';
import { cn } from '@/lib/utils';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';

interface DailyRefillsMeterProps {
  className?: string;
}

export function DailyRefillsMeter({ 
  className 
}: DailyRefillsMeterProps) {
  const { planName, rawCreditsTotal, rawCreditsRemaining } = useBilling();
  
  // Only show for free users
  const isFreeUser = planName?.toLowerCase() === 'free' || !planName;
  
  if (!isFreeUser) {
    return null;
  }

  // Calculate refills used this month
  // Each refill = 5 credits, max 4 refills = 20 credits total
  const maxRefills = 4;
  const creditsPerRefill = 5;
  
  // Calculate how many refills have been used based on total credits given vs remaining
  const creditsUsed = (rawCreditsTotal || 20) - (rawCreditsRemaining || 20);
  const refillsUsed = Math.min(Math.ceil(creditsUsed / creditsPerRefill), maxRefills);
  const refillsRemaining = maxRefills - refillsUsed;
  
  const progressPercentage = (refillsUsed / maxRefills) * 100;
  
  // Get next refill info (assuming daily refills)
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  
  const hoursUntilRefill = Math.ceil((tomorrow.getTime() - now.getTime()) / (1000 * 60 * 60));

  const tooltipContent = (
    <div className="max-w-sm space-y-3 text-foreground">
      <div className="flex items-center gap-2 font-semibold">
        <Zap className="h-4 w-4 text-blue-500" />
        <span>Daily Refills</span>
      </div>
      <ul className="text-sm space-y-1 text-foreground/90">
        <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5" /> <span>5 credits added each day (up to 4×/month)</span></li>
        <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5" /> <span>Refills reset at midnight</span></li>
        <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5" /> <span>Unused refills don’t carry over</span></li>
        <li className="flex items-start gap-2"><CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5" /> <span>Maximum 20 credits per month</span></li>
      </ul>
      {refillsRemaining > 0 ? (
        <div className="text-sm bg-blue-600/15 border border-blue-400/30 text-blue-100 p-3 rounded-md">
          <div className="font-medium">Next refill in ~{hoursUntilRefill} hours</div>
          <div>You'll receive {creditsPerRefill} more credits tomorrow.</div>
        </div>
      ) : (
        <div className="text-sm bg-amber-600/15 border border-amber-400/30 text-amber-100 p-3 rounded-md">
          <div className="font-medium">Monthly limit reached</div>
          <div>You've used all 4 daily refills this month. Upgrade for more credits.</div>
        </div>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      <div className={cn('space-y-3 border-t pt-3', className)}>
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 text-muted-foreground">
            Daily Refills
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 cursor-help hover:text-foreground transition-colors" />
              </TooltipTrigger>
              <TooltipContent side="top" className="p-4 rounded-md border ring-1 ring-border bg-background text-foreground shadow-xl">
                {tooltipContent}
              </TooltipContent>
            </Tooltip>
          </span>
          <span className="font-medium">
            {refillsUsed} / {maxRefills} used
          </span>
        </div>
        
        <Progress value={progressPercentage} className="h-2" />
        
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{refillsRemaining} refills remaining</span>
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            {creditsPerRefill} credits/refill
          </span>
        </div>
      </div>
    </TooltipProvider>
  );
}