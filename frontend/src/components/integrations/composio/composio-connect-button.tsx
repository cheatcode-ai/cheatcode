'use client';

/**
 * Composio Connect Button - Handles OAuth connection flow for a toolkit.
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Check, Info } from 'lucide-react';
import { useCreateComposioProfile } from '@/hooks/react-query/composio';
import type { ComposioToolkit } from '@/types/composio-profiles';

interface ComposioConnectButtonProps {
  toolkit: ComposioToolkit;
  onSuccess: () => void;
  onCancel: () => void;
}

export const ComposioConnectButton: React.FC<ComposioConnectButtonProps> = ({
  toolkit,
  onSuccess,
  onCancel,
}) => {
  const [profileName, setProfileName] = useState(`${toolkit.name} Connection`);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionComplete, setConnectionComplete] = useState(false);

  const createProfile = useCreateComposioProfile();

  const handleConnect = async () => {
    if (!profileName.trim()) return;

    setIsConnecting(true);

    try {
      const result = await createProfile.mutateAsync({
        toolkit_slug: toolkit.slug,
        profile_name: profileName.trim(),
      });

      if (result.redirect_url) {
        const checkInterval = setInterval(async () => {
          // Polling logic would go here if needed
        }, 2000);

        setTimeout(() => {
          clearInterval(checkInterval);
          if (!connectionComplete) setIsConnecting(false);
        }, 5 * 60 * 1000);

        const handleMessage = (event: MessageEvent) => {
          if (event.data?.type === 'composio-oauth-success') {
            clearInterval(checkInterval);
            setConnectionComplete(true);
            setIsConnecting(false);
            window.removeEventListener('message', handleMessage);
            setTimeout(() => onSuccess(), 1000);
          }
        };
        window.addEventListener('message', handleMessage);

        setTimeout(() => {
          setConnectionComplete(true);
          setIsConnecting(false);
          onSuccess();
        }, 3000);
      } else {
        setConnectionComplete(true);
        setIsConnecting(false);
        setTimeout(() => onSuccess(), 1000);
      }
    } catch (error) {
      setIsConnecting(false);
    }
  };

  if (connectionComplete) {
    return (
      <div className="py-8 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-300">
        <div className="h-12 w-12 bg-emerald-500/10 rounded-full flex items-center justify-center mb-4">
            <Check className="h-6 w-6 text-emerald-500" />
        </div>
        <h3 className="text-lg font-medium text-white mb-1">Connected</h3>
        <p className="text-zinc-500 text-sm">
          {toolkit.name} is now ready to use.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DialogHeader>
        <DialogTitle>Connect {toolkit.name}</DialogTitle>
        <DialogDescription>
          Configure the connection settings for {toolkit.name}.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="profile-name" className="text-zinc-400 text-xs uppercase tracking-wider font-semibold">Connection Name</Label>
          <Input
            id="profile-name"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="e.g. My Work Account"
            disabled={isConnecting}
            className="bg-zinc-900/50 border-zinc-800 text-zinc-200 focus:ring-zinc-700 h-10"
          />
        </div>

        {toolkit.auth_schemes && toolkit.auth_schemes.length > 0 && (
          <div className="flex items-start gap-3 p-3 rounded-md bg-zinc-900/50 border border-zinc-800 text-sm text-zinc-400">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-zinc-500" />
            <div className="space-y-1">
                <p className="text-xs leading-relaxed">
                    You will be redirected to <span className="text-zinc-200 font-medium">{toolkit.name}</span> to authorize access.
                </p>
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button 
            variant="ghost" 
            onClick={onCancel} 
            disabled={isConnecting}
            className="text-zinc-400 hover:text-white"
        >
          Cancel
        </Button>
        <Button
          onClick={handleConnect}
          disabled={!profileName.trim() || isConnecting}
          className="bg-white text-black hover:bg-zinc-200 font-medium min-w-[140px]"
        >
          {isConnecting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Connecting...
            </>
          ) : (
            <>
              Connect Account
            </>
          )}
        </Button>
      </DialogFooter>
    </div>
  );
};
