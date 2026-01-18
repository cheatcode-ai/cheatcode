'use client';

import { useBilling } from '@/contexts/BillingContext';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Globe, AlertTriangle } from 'lucide-react';

interface DeploymentMeterProps {
  variant?: 'minimal' | 'card';
  showUpgradePrompt?: boolean;
}

export function DeploymentMeter({ variant: _variant = 'minimal', showUpgradePrompt = true }: DeploymentMeterProps) {
  const { 
    deploymentsUsed,
    deploymentsTotal,
    deploymentUsagePercentage,
    isLoading 
  } = useBilling();

  if (isLoading) {
    return <div className="h-48 w-full bg-zinc-900/30 rounded-3xl animate-pulse" />;
  }

  const isAtLimit = deploymentsUsed >= deploymentsTotal;

  // Segmented Progress Bar (Blue)
  const SegmentedProgress = ({ value, total = 50 }: { value: number, total?: number }) => {
    const filledSegments = Math.round((value / 100) * total);
    return (
      <div className="flex gap-[2px] h-4 w-full mt-6 mb-3">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 rounded-[1px]",
              i < filledSegments ? "bg-blue-500" : "bg-zinc-800"
            )}
          />
        ))}
      </div>
    );
  };

  return (
    <Card className="w-full bg-[#111] border-zinc-800 shadow-xl overflow-hidden rounded-2xl">
      <CardContent className="p-8 space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-[10px] text-zinc-500 font-mono tracking-wider mb-1 uppercase flex items-center gap-2">
              <Globe className="h-3 w-3" />
              Deployments
            </div>
            <div className="text-4xl font-mono tracking-tighter text-white">
              {deploymentsUsed} <span className="text-xl text-zinc-600">/ {deploymentsTotal}</span>
            </div>
          </div>
        </div>

        <div>
          <SegmentedProgress value={deploymentUsagePercentage} />
          <div className="flex justify-between text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
            <span>{deploymentsUsed} Active</span>
            <span>{Math.max(0, deploymentsTotal - deploymentsUsed)} Slots Left</span>
          </div>
        </div>

        {isAtLimit && showUpgradePrompt && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-lg mt-4">
            <AlertTriangle className="h-4 w-4" />
            <span>Limit reached. Upgrade to deploy more.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}