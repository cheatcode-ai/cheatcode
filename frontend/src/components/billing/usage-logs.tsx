'use client';

import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ExternalLink, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { OpenInNewWindowIcon } from '@radix-ui/react-icons';
import { useUsageLogs } from '@/hooks/react-query/subscriptions/use-billing';
import { TokenUsageEntry } from '@/lib/api';



interface DailyUsage {
  date: string;
  logs: TokenUsageEntry[];
  totalTokens: number;
  totalCost: number;
  requestCount: number;
  models: string[];
}

interface Props {
  accountId: string;
}

export default function UsageLogs({ accountId }: Props) {
  const [daysFilter, setDaysFilter] = useState(30);

  // Use React Query hook for usage logs
  const { data: usageData, isLoading, error, refetch } = useUsageLogs(daysFilter);

  // Extract logs from usage data
  const logs = (usageData as any)?.usage_entries || [];

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatCost = (cost: number | string) => {
    if (typeof cost === 'string' || cost === 0) {
      return typeof cost === 'string' ? cost : '$0.0000';
    }
    return `$${cost.toFixed(4)}`;
  };

  const formatDateOnly = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleThreadClick = (threadId: string, projectId: string) => {
    // Navigate to the thread using the project_id from the JOIN query
    const threadUrl = `/projects/${projectId}/thread/${threadId}`;
    window.open(threadUrl, '_blank');
  };

  // Group usage logs by date
  const groupLogsByDate = (logs: TokenUsageEntry[]): DailyUsage[] => {
    const grouped = logs.reduce(
      (acc, log) => {
        const date = new Date(log.created_at).toDateString();

        if (!acc[date]) {
          acc[date] = {
            date,
            logs: [],
            totalTokens: 0,
            totalCost: 0,
            requestCount: 0,
            models: [],
          };
        }

        acc[date].logs.push(log);
        acc[date].totalTokens += log.total_tokens;
        acc[date].totalCost +=
          typeof log.estimated_cost === 'number' ? log.estimated_cost : 0;
        acc[date].requestCount += 1;

        if (!acc[date].models.includes(log.model)) {
          acc[date].models.push(log.model);
        }

        return acc;
      },
      {} as Record<string, DailyUsage>,
    );

    return Object.values(grouped).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  };



  if (isLoading && !usageData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage Logs</CardTitle>
          <CardDescription>Loading your token usage history...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">
              Error: {error.message || 'Failed to load usage logs'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Handle local development mode message
  if ((usageData as any)?.message) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-muted/30 border border-border rounded-lg text-center">
            <p className="text-sm text-muted-foreground">
              {(usageData as any).message}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const dailyUsage = groupLogsByDate(logs);
  const totalUsage = logs.reduce(
    (sum, log) =>
      sum + (typeof log.estimated_cost === 'number' ? log.estimated_cost : 0),
    0,
  );

  return (
    <div className="space-y-6 w-full">
      {/* Usage Logs Accordion */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Usage Logs</CardTitle>
          <CardDescription>
            <div className='flex justify-between items-center'>
              Your token usage organized by day, sorted by most recent.
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dailyUsage.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No usage logs found.</p>
            </div>
          ) : (
            <>
              <Accordion type="single" collapsible className="w-full">
                {dailyUsage.map((day) => (
                  <AccordionItem key={day.date} value={day.date}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex justify-between items-center w-full mr-4">
                        <div className="text-left">
                          <div className="font-semibold">
                            {formatDateOnly(day.date)}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {day.requestCount} request
                            {day.requestCount !== 1 ? 's' : ''} •{' '}
                            {day.models.join(', ')}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-semibold">
                            {formatCost(day.totalCost)}
                          </div>
                          <div className="text-sm text-muted-foreground font-mono">
                            {day.totalTokens.toLocaleString()} tokens
                          </div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="rounded-md border mt-4">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Time</TableHead>
                              <TableHead>Model</TableHead>
                              <TableHead className="text-right">
                                Tokens
                              </TableHead>
                              <TableHead className="text-right">Cost</TableHead>
                              <TableHead className="text-center">
                                Thread
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {day.logs.map((log) => (
                              <TableRow key={log.id}>
                                <TableCell className="font-mono text-sm">
                                  {new Date(
                                    log.created_at,
                                  ).toLocaleTimeString()}
                                </TableCell>
                                <TableCell>
                                  <Badge className="font-mono text-xs">
                                    {log.model}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono font-medium text-sm">
                                  {log.prompt_tokens.toLocaleString()}{' '}
                                  -&gt;{' '}
                                  {log.completion_tokens.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right font-mono font-medium text-sm">
                                  {formatCost(log.estimated_cost)}
                                </TableCell>
                                <TableCell className="text-center">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      handleThreadClick(log.thread_id || '', log.project_id || '')
                                    }
                                    disabled={!log.thread_id || !log.project_id}
                                    className="h-8 w-8 p-0"
                                    title={
                                      !log.thread_id ? "Thread ID not available" : 
                                      !log.project_id ? "Project ID not available" : 
                                      "Open thread in new tab"
                                    }
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>


            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
