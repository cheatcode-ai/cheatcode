'use client';

import React from 'react';
import { useBilling } from '@/contexts/BillingContext';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Zap, Calendar } from 'lucide-react';
import { DailyRefillsMeter } from '@/components/billing/DailyRefillsMeter';

interface CreditMeterProps {
  variant?: 'minimal' | 'card' | 'detailed';
  showUpgradePrompt?: boolean;
}

export function CreditMeter({ variant = 'minimal', showUpgradePrompt = true }: CreditMeterProps) {
  const { 
    creditsRemaining, 
    creditsTotal, 
    creditsUsagePercentage, 
    planName, 
    isUpgradeRequired, 
    quotaResetsAt,
    isLoading,
    deploymentsUsed,
    deploymentsTotal,
    deploymentUsagePercentage
  } = useBilling();

  if (isLoading) {
    return (
      <div className="flex items-center space-x-2 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-16"></div>
        <div className="h-4 bg-gray-200 rounded w-24"></div>
      </div>
    );
  }

  const formatResetDate = (isoString: string | null) => {
    if (!isoString) return 'Unknown';
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
    });
  };

  const getStatusColor = () => {
    if (isUpgradeRequired) return 'destructive';
    if (creditsUsagePercentage > 80) return 'warning';
    return 'default';
  };

  const getProgressColor = () => {
    if (isUpgradeRequired) return 'bg-red-500';
    if (creditsUsagePercentage > 80) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  if (variant === 'minimal') {
    return (
      <div className="flex items-center space-x-2">
        <Zap className="h-4 w-4 text-blue-600" />
        <span className="text-sm font-medium">
          {creditsRemaining} / {creditsTotal} credits
        </span>
        {isUpgradeRequired && showUpgradePrompt && (
          <Badge variant="destructive" className="text-xs">
            Upgrade Required
          </Badge>
        )}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <Card className="w-full overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4 text-blue-500" />
            <span>Credits Usage</span>
            <Badge
              variant="secondary"
              className="ml-auto rounded-full bg-black/60 text-white border border-white/20 px-2.5 py-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] flex items-center gap-1.5 text-sm"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
              {planName}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Credits</span>
              <span className="font-semibold tabular-nums">
                {creditsRemaining} / {creditsTotal}
              </span>
            </div>
            <Progress 
              value={creditsUsagePercentage} 
              className="h-2 rounded-full"
              indicatorClassName={getProgressColor()}
            />
            {isUpgradeRequired && showUpgradePrompt && (
              <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 p-2 rounded-md">
                <AlertTriangle className="h-4 w-4" />
                <span>Upgrade required to continue</span>
              </div>
            )}
            {quotaResetsAt && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>Resets on {formatResetDate(quotaResetsAt)}</span>
              </div>
            )}
          </div>

          {/* Daily refills summary for Free plan */}
          <DailyRefillsMeter className="pt-2" />
        </CardContent>
      </Card>
    );
  }

  // Detailed variant
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          <span>Credit Usage</span>
          <Badge
            variant="secondary"
            className="ml-auto rounded-full bg-black/60 text-white border border-white/20 px-2.5 py-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] flex items-center gap-1.5 text-sm"
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
            {planName} Plan
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Credits Remaining</div>
            <div className="text-2xl font-bold text-blue-600">
              {creditsRemaining}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Total Credits</div>
            <div className="text-2xl font-bold">
              {creditsTotal}
            </div>
          </div>
        </div>
        
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">Usage</span>
            <span className="font-medium">
              {Math.round(creditsUsagePercentage)}% used
            </span>
          </div>
          <Progress 
            value={creditsUsagePercentage} 
            className="h-3"
            indicatorClassName={getProgressColor()}
          />
        </div>
        
        {isUpgradeRequired && showUpgradePrompt && (
          <div className="flex items-center space-x-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
            <AlertTriangle className="h-5 w-5" />
            <div>
              <div className="font-medium">Upgrade Required</div>
              <div className="text-xs text-red-500">
                You've reached your credit limit. Upgrade to continue using the service.
              </div>
            </div>
          </div>
        )}
        
        {quotaResetsAt && (
          <div className="flex items-center justify-between text-sm text-muted-foreground bg-gray-50 p-3 rounded-lg">
            <div className="flex items-center space-x-2">
              <Calendar className="h-4 w-4" />
              <span>Credits reset on</span>
            </div>
            <span className="font-medium">
              {formatResetDate(quotaResetsAt)}
            </span>
          </div>
        )}
        
        {/* Add Daily Refills for Free Users */}
        <DailyRefillsMeter />
      </CardContent>
    </Card>
  );
}