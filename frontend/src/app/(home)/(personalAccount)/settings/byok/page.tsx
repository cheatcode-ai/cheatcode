'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  SquareAsterisk,
  Settings,
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
  Loader2,
  BadgeDollarSign,
  Infinity,
  Shield,
  Zap,
  Lock,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { 
  useOpenRouterKeyStatus, 
  useTestOpenRouterKey, 
  useSaveOpenRouterKey, 
  useDeleteOpenRouterKey,
  type KeyTestResult 
} from '@/hooks/react-query/settings/use-settings-queries';
import { useBilling } from '@/contexts/BillingContext';
import { useModal } from '@/hooks/use-modal-store';

export default function ByokPage() {
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [displayName, setDisplayName] = useState('OpenRouter API Key');
  const { planName, billingStatus } = useBilling();
  const { onOpen } = useModal();
  const isByokPlan = (billingStatus?.plan_id || planName || '').toLowerCase() === 'byok';

  // React Query hooks for data fetching and mutations
  const { 
    data: keyStatus, 
    isLoading: isKeyStatusLoading, 
    error: keyStatusError 
  } = useOpenRouterKeyStatus();
  
  const testKeyMutation = useTestOpenRouterKey();
  const saveKeyMutation = useSaveOpenRouterKey();
  const deleteKeyMutation = useDeleteOpenRouterKey();

  // Update display name when key status loads
  React.useEffect(() => {
    if (keyStatus?.display_name) {
      setDisplayName(keyStatus.display_name);
    }
  }, [keyStatus?.display_name]);

  const validateKeyFormat = (key: string): boolean => {
    // OpenRouter API keys: sk-or-v1- followed by 64 hexadecimal characters
    return /^sk-or-v1-[a-f0-9]{64}$/i.test(key);
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      toast.error("Please enter an API key to test");
      return;
    }

    if (!validateKeyFormat(apiKey)) {
      toast.error("OpenRouter API keys must start with 'sk-or-v1-' followed by 64 hexadecimal characters");
      return;
    }

    try {
      const result = await testKeyMutation.mutateAsync(apiKey);

      if (result.success) {
        let message = result.message || "API key is valid and working";
        
        // Add key info if available
        if (result.key_info) {
          const { usage, limit, limit_remaining, is_free_tier } = result.key_info;
          if (limit !== null && limit_remaining !== null) {
            message += ` (${limit_remaining}/${limit} credits remaining)`;
          } else if (usage > 0) {
            message += ` (${usage} credits used)`;
          }
          if (is_free_tier) {
            message += " • Free tier account";
          }
        }
        
        toast.success(`✅ API Key Valid: ${message}`);
      } else {
        toast.error(`❌ Test Failed: ${result.error || "API key test failed"}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to test API key: ${errorMsg}`);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      toast.error("Please enter an API key");
      return;
    }

    if (!validateKeyFormat(apiKey)) {
      toast.error("OpenRouter API keys must start with 'sk-or-v1-' followed by 64 hexadecimal characters");
      return;
    }

    try {
      await saveKeyMutation.mutateAsync({
        api_key: apiKey,
        display_name: displayName,
      });

      toast.success("OpenRouter API key saved successfully");
      setApiKey(''); // Clear the input for security
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to save API key: ${errorMsg}`);
    }
  };

  const handleDisconnect = async () => {
    try {
      await deleteKeyMutation.mutateAsync();
      
      toast.success("OpenRouter API key removed successfully");
      setApiKey('');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to remove API key: ${errorMsg}`);
    }
  };

  const Benefit = ({
    icon: Icon,
    title,
    description,
  }: {
    icon: any;
    title: string;
    description: string;
  }) => (
    <div className="flex items-start gap-3">
      <div className="p-2 rounded-md bg-primary/10 border border-primary/20">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-sm text-muted-foreground leading-relaxed">{description}</div>
      </div>
    </div>
  );

  const StatusBadge = ({
    loading = false,
    connected = false,
    label,
  }: { loading?: boolean; connected?: boolean; label?: string }) => {
    if (loading) {
      return (
        <span className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-200">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking…
        </span>
      );
    }

    const classes = connected
      ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
      : 'border-rose-400/30 bg-rose-500/10 text-rose-200';

    return (
      <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs border ${classes}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
        {label || (connected ? 'Connected' : 'Not connected')}
      </span>
    );
  };

  return (
    <div className="space-y-6 w-full">
      {/* BYOK header block styled like Integrations */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card to-muted/20 p-6 shadow-sm">
        <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:20px_20px]" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-primary/20 to-primary/10 rounded-xl border border-primary/20 shadow-sm">
              <SquareAsterisk className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Bring Your Own Key (BYOK)</h3>
              <p className="text-sm text-muted-foreground">Connect your OpenRouter key to use your own credits</p>
            </div>
          </div>
          <StatusBadge loading={isKeyStatusLoading} connected={!!keyStatus?.key_configured} />
        </div>
      </div>

      {/* Benefits Card */}
      <Card className="rounded-2xl border border-border bg-card/90 backdrop-blur-sm shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SquareAsterisk className="h-5 w-5 text-red-500" />
            BYOK Benefits
          </CardTitle>
          <CardDescription>Why use your own API keys?</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <Benefit
              icon={BadgeDollarSign}
              title="Cost Savings"
              description="Pay only for what you use, billed directly by the provider with no markup."
            />
            <Benefit
              icon={Infinity}
              title="Unlimited Usage"
              description="No artificial credit limits or monthly caps on your AI interactions."
            />
            <Benefit
              icon={Zap}
              title="Priority Access"
              description="Skip rate limits and enjoy consistent performance and support."
            />
            <Benefit
              icon={Shield}
              title="Data Privacy"
              description="Your API keys and data remain fully under your control at all times."
            />
          </div>
        </CardContent>
      </Card>

      {/* Current Key Status */}
      {keyStatus?.has_key && (
        <Card className="rounded-2xl border border-border bg-card/90 backdrop-blur-sm shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Current Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Key Name</p>
                <p className="font-medium">{keyStatus.display_name}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <StatusBadge connected={keyStatus.key_configured} label={keyStatus.key_configured ? 'Active' : 'Inactive'} />
              </div>
              {keyStatus.created_at && (
                <div>
                  <p className="text-muted-foreground">Added</p>
                  <p className="font-medium">{new Date(keyStatus.created_at).toLocaleDateString()}</p>
                </div>
              )}
              {keyStatus.last_used_at && (
                <div>
                  <p className="text-muted-foreground">Last Used</p>
                  <p className="font-medium">{new Date(keyStatus.last_used_at).toLocaleDateString()}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* API Configuration (gated for BYOK plan) */}
      <Card className="relative rounded-2xl border border-border bg-card/90 backdrop-blur-sm shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            OpenRouter Configuration
          </CardTitle>
          <CardDescription>
            Connect your OpenRouter API key for unlimited AI model access
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isByokPlan && (
            <div className="absolute inset-0 z-10 rounded-2xl bg-black/60 backdrop-blur-[2px] ring-1 ring-white/10 flex items-center justify-center text-center px-6">
              <div className="max-w-md">
                <div className="inline-flex items-center gap-2 rounded-full bg-pink-500/15 text-pink-300 ring-1 ring-pink-500/25 px-3 py-1 text-[11px] font-semibold mb-3">
                  <Lock className="h-3.5 w-3.5" />
                </div>
                <div className="text-sm text-zinc-200 mb-3 font-medium">OpenRouter configuration is available on the BYOK plan.</div>
                <div className="text-xs text-zinc-400 mb-4">Upgrade to connect your own OpenRouter API key and use your credits directly.</div>
                <div className="flex items-center justify-center">
                  <Button size="sm" className="rounded-full" onClick={() => onOpen('paymentRequiredDialog')}>
                    Upgrade plan
                  </Button>
                </div>
              </div>
            </div>
          )}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your API keys are encrypted and stored securely. We never log or store your API requests.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="display-name">Key Name (Optional)</Label>
            <Input
              id="display-name"
              type="text"
              placeholder="My OpenRouter API Key"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={!isByokPlan || saveKeyMutation.isPending || deleteKeyMutation.isPending}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="openrouter-key">OpenRouter API Key</Label>
            <div className="relative">
              <Input
                id="openrouter-key"
                type={showApiKey ? 'text' : 'password'}
                placeholder="sk-or-v1-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="pr-10"
                disabled={!isByokPlan || saveKeyMutation.isPending || deleteKeyMutation.isPending}
              />
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowApiKey(!showApiKey)}
                disabled={!isByokPlan || saveKeyMutation.isPending || deleteKeyMutation.isPending}
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Get your API key from{' '}
              <a 
                href="https://openrouter.ai/keys" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                openrouter.ai/keys
              </a>
            </p>
          </div>

          {/* Test Result Display - Using mutation data directly */}
          {testKeyMutation.data && (
            <Alert variant={testKeyMutation.data.success ? "default" : "destructive"}>
              {testKeyMutation.data.success ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <AlertDescription>
                <div className="space-y-1">
                  <p>{testKeyMutation.data.success ? testKeyMutation.data.message : testKeyMutation.data.error}</p>
                  {testKeyMutation.data.success && testKeyMutation.data.key_info && (
                    <div className="text-xs text-muted-foreground space-y-1 mt-2">
                      <div className="grid grid-cols-2 gap-2">
                        <span>Usage: {testKeyMutation.data.key_info.usage} credits</span>
                        <span>
                          Limit: {testKeyMutation.data.key_info.limit !== null ? `${testKeyMutation.data.key_info.limit} credits` : 'Unlimited'}
                        </span>
                        {testKeyMutation.data.key_info.limit !== null && testKeyMutation.data.key_info.limit_remaining !== null && (
                          <>
                            <span>Remaining: {testKeyMutation.data.key_info.limit_remaining} credits</span>
                            <span>Account: {testKeyMutation.data.key_info.is_free_tier ? 'Free tier' : 'Paid'}</span>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button 
              onClick={handleTestConnection} 
              variant="outline"
              disabled={!isByokPlan || !apiKey.trim() || testKeyMutation.isPending}
            >
              {testKeyMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                'Test Connection'
              )}
            </Button>

            {keyStatus?.has_key ? (
              <Button 
                variant="destructive" 
                onClick={handleDisconnect}
                disabled={!isByokPlan || deleteKeyMutation.isPending}
              >
                {deleteKeyMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Removing...
                  </>
                ) : (
                  'Remove Key'
                )}
              </Button>
            ) : (
              <Button 
                onClick={handleSaveApiKey} 
                disabled={!isByokPlan || !apiKey.trim() || saveKeyMutation.isPending}
              >
                {saveKeyMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save API Key'
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Usage Stats */}
      {keyStatus?.key_configured && (
        <Card className="rounded-2xl border border-border bg-card/90 backdrop-blur-sm shadow-sm">
          <CardHeader>
            <CardTitle>Usage Statistics</CardTitle>
            <CardDescription>
              Your current usage with your OpenRouter API key
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold">Direct Billing</div>
                <div className="text-sm text-muted-foreground">To OpenRouter</div>
              </div>
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold">Unlimited</div>
                <div className="text-sm text-muted-foreground">API Calls</div>
              </div>
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold">No Markup</div>
                <div className="text-sm text-muted-foreground">Direct Pricing</div>
              </div>
            </div>
            <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>💡 Cost Advantage:</strong> With BYOK, you pay OpenRouter directly with no markup. 
                You only pay for what you use, and all detailed usage appears in your usage logs.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}