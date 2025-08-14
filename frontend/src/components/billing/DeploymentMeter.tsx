'use client';

import React from 'react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Globe, AlertTriangle } from 'lucide-react';
import { useBilling } from '@/contexts/BillingContext';

interface DeploymentMeterProps {
  variant?: 'minimal' | 'card';
  showUpgradePrompt?: boolean;
}

export function DeploymentMeter({ variant = 'minimal', showUpgradePrompt = true }: DeploymentMeterProps) {
  const { 
    deploymentsUsed, 
    deploymentsTotal, 
    deploymentUsagePercentage, 
    planName, 
    isLoading 
  } = useBilling();

  if (isLoading) {
    return (
      <div className="flex items-center space-x-2 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-16"></div>
        <div className="h-4 bg-gray-200 rounded w-24"></div>
      </div>
    );
  }

  const getProgressColor = () => {
    if (deploymentUsagePercentage > 90) return 'bg-red-500';
    if (deploymentUsagePercentage > 75) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const isAtLimit = deploymentsUsed >= deploymentsTotal;

  if (variant === 'minimal') {
    return (
      <div className="flex items-center space-x-2">
        <Globe className="h-4 w-4 text-blue-600" />
        <span className="text-sm font-medium">
          {deploymentsUsed} / {deploymentsTotal} deployments
        </span>
        {isAtLimit && showUpgradePrompt && (
          <Badge variant="destructive" className="text-xs">
            Limit Reached
          </Badge>
        )}
      </div>
    );
  }

  // Card variant
  return (
    <Card className="w-full overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Globe className="h-4 w-4 text-blue-500" />
          <span>Deployments</span>
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
            <span className="text-muted-foreground">Deployed Websites</span>
            <span className="font-semibold tabular-nums">
              {deploymentsUsed} / {deploymentsTotal}
            </span>
          </div>
          <Progress 
            value={deploymentUsagePercentage} 
            className="h-2 rounded-full"
            indicatorClassName={getProgressColor()}
          />
          {isAtLimit && showUpgradePrompt && (
            <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 p-2 rounded-md">
              <AlertTriangle className="h-4 w-4" />
              <span>Deployment limit reached. Upgrade to deploy more websites.</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
