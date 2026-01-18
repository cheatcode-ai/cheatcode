'use client';

import { useBilling } from '@/contexts/BillingContext';
import { cn } from '@/lib/utils';
import { DailyRefillsMeter } from './DailyRefillsMeter';
import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';

interface CreditMeterProps {
  variant?: 'minimal' | 'card' | 'detailed';
  showUpgradePrompt?: boolean;
}

export function CreditMeter({ variant = 'minimal', showUpgradePrompt: _showUpgradePrompt = true }: CreditMeterProps) {
  const { 
    creditsRemaining, 
    creditsTotal, 
    creditsUsagePercentage,
    planName,
    isLoading,
  } = useBilling();

  // Mock history data
  const history = [
    { date: 'Dec 21, 09:26 PM', model: 'Claude 4.5 Sonnet', credits: '641.5K', cost: '$0.54' },
    { date: 'Dec 21, 09:21 PM', model: 'Claude 4.5 Sonnet', credits: '334.1K', cost: '$0.27' },
    { date: 'Dec 21, 09:18 PM', model: 'GPT 4o', credits: '194.4K', cost: '$0.11' },
    { date: 'Dec 21, 09:16 PM', model: 'Claude 3.5 Sonnet', credits: '277.1K', cost: '$0.21' },
  ];

  if (isLoading) {
    return <div className="h-48 w-full bg-zinc-900/30 rounded-3xl animate-pulse" />;
  }

  // Restored Segmented Progress Bar (Orange)
  const SegmentedProgress = ({ value, total = 50 }: { value: number, total?: number }) => {
    const filledSegments = Math.round((value / 100) * total);
    return (
      <div className="flex gap-[2px] h-5 w-full mt-6 mb-3">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 rounded-[1px]",
              i < filledSegments ? "bg-orange-500" : "bg-zinc-800"
            )}
          />
        ))}
      </div>
    );
  };

  if (variant === 'minimal') return null;

  return (
    <Card className="w-full bg-[#111] border-zinc-800 shadow-xl overflow-hidden rounded-2xl">
      <CardContent className="p-8 space-y-6">
          {/* Header Section */}
          <div className="flex justify-between items-start">
              <div>
                  <div className="text-[10px] text-zinc-500 font-mono tracking-wider mb-1 uppercase">Credits Used</div>
                  <div className="text-5xl font-mono tracking-tighter text-white">
                      {creditsUsagePercentage.toFixed(1)}%
                  </div>
              </div>
              <div className="flex flex-col items-end">
                  <div className={cn(
                      "px-3 py-1 rounded-full border text-[10px] font-medium tracking-widest uppercase shadow-sm backdrop-blur-md",
                      planName?.toLowerCase() === 'pro' 
                          ? "bg-gradient-to-b from-blue-500/20 to-blue-500/5 border-blue-500/30 text-blue-200 shadow-[0_0_10px_rgba(59,130,246,0.1)]"
                          : "bg-gradient-to-b from-zinc-700/50 to-zinc-800/50 border-zinc-700/50 text-zinc-300"
                  )}>
                      {planName?.toLowerCase() === 'pro' ? 'PRO' : (planName || 'Free Plan')}
                  </div>
              </div>
          </div>

          {/* Progress Bar */}
          <div>
              <SegmentedProgress value={creditsUsagePercentage} />
              <div className="flex justify-between text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                  <span>{Math.round(creditsTotal - creditsRemaining).toLocaleString()} / {creditsTotal.toLocaleString()} Credits</span>
                  <span>{creditsRemaining.toLocaleString()} Credits Left</span>
              </div>
          </div>

          <Separator className="bg-zinc-800/50 my-6" />

          {/* Usage History Header */}
          <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-zinc-300">Usage History</span>
                  <Link href="/settings/usage-logs" className="h-6 flex items-center justify-center text-xs rounded-full px-3 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
                      View all
                  </Link>
              </div>
              <Select defaultValue="30">
                  <SelectTrigger className="w-[100px] h-7 text-xs bg-transparent border-zinc-800 text-zinc-400">
                      <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#111] border-zinc-800 text-zinc-300">
                      <SelectItem value="30">30 Days</SelectItem>
                      <SelectItem value="7">7 Days</SelectItem>
                  </SelectContent>
              </Select>
          </div>

          {/* Minimal Table */}
          <div className="overflow-hidden">
              <Table>
                  <TableHeader className="bg-transparent hover:bg-transparent">
                      <TableRow className="hover:bg-transparent border-none">
                          <TableHead className="text-[10px] font-mono uppercase text-zinc-600 h-8 pl-0">Date</TableHead>
                          <TableHead className="text-[10px] font-mono uppercase text-zinc-600 h-8">Model</TableHead>
                          <TableHead className="text-[10px] font-mono uppercase text-zinc-600 h-8 text-right">Credits</TableHead>
                          <TableHead className="text-[10px] font-mono uppercase text-zinc-600 h-8 text-right pr-0">Cost</TableHead>
                      </TableRow>
                  </TableHeader>
                  <TableBody>
                      {history.map((item, i) => (
                          <TableRow key={i} className="hover:bg-zinc-900/50 border-zinc-800/30 text-xs font-mono group transition-colors">
                              <TableCell className="py-2.5 pl-0 text-zinc-500 group-hover:text-zinc-400">{item.date}</TableCell>
                              <TableCell className="py-2.5 text-zinc-400 group-hover:text-white">{item.model}</TableCell>
                              <TableCell className="py-2.5 text-right text-zinc-500 group-hover:text-zinc-400">{item.credits}</TableCell>
                              <TableCell className="py-2.5 text-right pr-0 text-zinc-400 group-hover:text-white">{item.cost}</TableCell>
                          </TableRow>
                      ))}
                  </TableBody>
              </Table>
          </div>
          
          <DailyRefillsMeter />
      </CardContent>
    </Card>
  );
}