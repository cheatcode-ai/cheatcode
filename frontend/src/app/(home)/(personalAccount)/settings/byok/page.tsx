'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Eye, EyeOff, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import {
  useOpenRouterKeyStatus,
  useSaveOpenRouterKey,
  useDeleteOpenRouterKey,
} from '@/hooks/react-query/settings/use-settings-queries';
import { useBilling } from '@/contexts/BillingContext';

export default function ByokPage() {
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const { planName, billingStatus } = useBilling();
  const isByokPlan = (billingStatus?.plan_id || planName || '').toLowerCase() === 'byok';

  const { data: keyStatus, isLoading } = useOpenRouterKeyStatus();
  const saveKeyMutation = useSaveOpenRouterKey();
  const deleteKeyMutation = useDeleteOpenRouterKey();

  const handleSave = async () => {
    if (!apiKey.trim()) return toast.error("Enter API key");
    try {
      await saveKeyMutation.mutateAsync({ api_key: apiKey, display_name: 'Key' });
      toast.success("Saved");
      setApiKey('');
    } catch { toast.error("Failed"); }
  };

  const handleDisconnect = async () => {
    try { await deleteKeyMutation.mutateAsync(); toast.success("Removed"); } 
    catch { toast.error("Failed"); }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-500">
        <Loader2 className="animate-spin w-6 h-6" />
      </div>
    );
  }

  // If there's an error (e.g. 403 for non-BYOK plan), allow the UI to render
  // so the user sees the "Upgrade" overlay or default state.

  return (
    <div className="text-zinc-200 flex flex-col items-center">
        
        <div className="text-center mb-10 space-y-6">
            <h1 className="text-2xl font-medium text-white">Bring Your Own Key</h1>
            <p className="text-zinc-500">Connect OpenRouter directly.</p>
        </div>

        <div className="w-full max-w-md relative">
            {!isByokPlan && (
                <div className="absolute -inset-4 z-10 bg-[#050505]/80 backdrop-blur-sm flex flex-col items-center justify-center space-y-4 border border-zinc-800/50 rounded-3xl">
                    <Badge variant="secondary" className="bg-zinc-100 text-black hover:bg-white">BYOK Plan Required</Badge>
                </div>
            )}

            {keyStatus?.has_key ? (
                <div className="bg-zinc-900/20 border border-zinc-800/50 rounded-3xl p-8 text-center space-y-6">
                    <div className="mx-auto h-16 w-16 bg-emerald-500/10 rounded-full flex items-center justify-center text-emerald-500 mb-2">
                        <Check className="w-8 h-8" />
                    </div>
                    <div className="space-y-1">
                        <h3 className="text-white font-medium">Active Connection</h3>
                        <p className="text-zinc-500 text-sm">Your API key is encrypted and active.</p>
                    </div>
                    <Button 
                        variant="ghost" 
                        onClick={handleDisconnect}
                        disabled={deleteKeyMutation.isPending}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                        {deleteKeyMutation.isPending ? 'Removing...' : 'Disconnect'}
                    </Button>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="relative group">
                        <Input
                            type={showApiKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="sk-or-v1-..."
                            className="h-14 pl-6 pr-12 bg-zinc-900/30 border-zinc-800 focus:border-zinc-600 rounded-2xl text-lg font-mono transition-all text-white placeholder:text-zinc-700"
                            disabled={!isByokPlan || saveKeyMutation.isPending}
                        />
                        <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
                        >
                            {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                    </div>

                    <Button 
                        onClick={handleSave} 
                        disabled={!isByokPlan || !apiKey || saveKeyMutation.isPending}
                        className="w-full h-12 rounded-2xl bg-white text-black hover:bg-zinc-200 font-medium text-base transition-all"
                    >
                        {saveKeyMutation.isPending ? <Loader2 className="animate-spin" /> : 'Connect Key'}
                    </Button>
                    
                    <p className="text-center text-xs text-zinc-600 pt-4">
                        We encrypt your key securely. <a href="https://openrouter.ai/keys" target="_blank" className="text-zinc-400 hover:text-white underline">Get key</a>
                    </p>
                </div>
            )}
        </div>
    </div>
  );
}
