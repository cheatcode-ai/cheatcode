'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  Clock,
  Server,
  Cpu,
  Cloud,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useApiHealth } from '@/hooks/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { isLocalMode } from '@/lib/config';
import { CheatcodeLogo } from '@/components/sidebar/cheatcode-logo';

export function MaintenancePage() {
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const { isLoading: isCheckingHealth, refetch } = useApiHealth();

  const checkHealth = async () => {
    try {
      const result = await refetch();
      if (result.data) {
        window.location.reload();
      }
    } catch (error) {
      // API health check failed - will retry on next click
    } finally {
      setLastChecked(new Date());
    }
  };

  useEffect(() => {
    setLastChecked(new Date());
  }, []);

  const headline = useMemo(
    () => (isLocalMode() ? 'Backend Offline' : "We'll be right back"),
    []
  );

  const subcopy = useMemo(
    () =>
      isLocalMode()
        ? 'We\'ll be right back'
        : "We're performing scheduled maintenance to improve your experience. Our systems will be back online shortly.",
    []
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background">
      {/* Decorative background accents */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-32 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-purple-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-4 py-16">
        {/* Logo + emblem */}
        <div className="mb-6 flex items-center justify-center">
          <div className="relative">
            <div className="absolute inset-0 rounded-2xl bg-primary/30 blur-xl" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-primary/20 bg-background/70 shadow-[0_0_0_1px_rgba(255,255,255,0.05)] backdrop-blur-xl">
              <CheatcodeLogo size={40} />
            </div>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
            <AlertCircle className="mr-1 h-3.5 w-3.5" />
            Scheduled maintenance
          </Badge>
        </div>

        <h1 className="bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-center text-3xl font-semibold tracking-tight text-transparent md:text-4xl">
          {headline}
        </h1>
        <p className="mt-2 max-w-2xl text-center text-sm leading-relaxed text-muted-foreground md:text-base">
          {subcopy}
        </p>

        {/* Main card */}
        <Card className="mt-8 w-full border-border/60 bg-background/60 backdrop-blur-xl">
          <CardContent className="p-6 md:p-8">
            {/* Status tiles */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                  API
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Server className="h-3.5 w-3.5" />
                  Offline
                </div>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                  Agents
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Cpu className="h-3.5 w-3.5" />
                  Paused
                </div>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                  Realtime
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Cloud className="h-3.5 w-3.5" />
                  Unavailable
                </div>
              </div>
            </div>

            {/* Process timeline */}
            <div className="mt-8">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                Maintenance steps
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    Backups verified
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Integrity checks completed prior to updates.</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Wrench className="h-4 w-4 text-primary" />
                    Applying updates
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Rolling out improvements and security patches.</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Server className="h-4 w-4 text-blue-500" />
                    Verifying services
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Ensuring stability across core components.</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <RefreshCw className="h-4 w-4 text-violet-500" />
                    Bringing systems online
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Restoring access in stages to avoid disruptions.</p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-8 flex flex-col items-center justify-center gap-3 md:flex-row">
              <Button
                onClick={checkHealth}
                disabled={isCheckingHealth}
                size="lg"
                className="w-full md:w-auto"
              >
                {isCheckingHealth ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking status
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Check status
                  </>
                )}
              </Button>
              {lastChecked && (
                <div className="flex items-center text-sm text-muted-foreground">
                  <Clock className="mr-2 h-4 w-4" />
                  Last checked: {lastChecked.toLocaleTimeString()}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Footer help text */}
        <div className="mt-6 text-center text-xs text-muted-foreground">
          {isLocalMode()
            ? 'Tip: Run your backend services (e.g., via docker-compose) and refresh this page.'
            : 'Thanks for your patience while we finalize updates.'}
        </div>
      </div>
    </div>
  );
}
