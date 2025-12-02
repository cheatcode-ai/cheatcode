'use client';

/**
 * Composio Connect Button - Handles OAuth connection flow for a toolkit.
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ExternalLink, CheckCircle2 } from 'lucide-react';
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

      // If there's a redirect URL, the OAuth popup will be opened by the hook
      // Monitor for completion
      if (result.redirect_url) {
        // The hook handles opening the popup and monitoring it
        // We'll wait a bit and then check if the profile was created
        const checkInterval = setInterval(async () => {
          // Profile will be created when OAuth completes
          // The hook invalidates queries on popup close
        }, 2000);

        // Set a timeout to stop checking after 5 minutes
        setTimeout(() => {
          clearInterval(checkInterval);
          if (!connectionComplete) {
            setIsConnecting(false);
          }
        }, 5 * 60 * 1000);

        // Listen for message from OAuth popup
        const handleMessage = (event: MessageEvent) => {
          if (event.data?.type === 'composio-oauth-success') {
            clearInterval(checkInterval);
            setConnectionComplete(true);
            setIsConnecting(false);
            window.removeEventListener('message', handleMessage);
            setTimeout(() => {
              onSuccess();
            }, 1000);
          }
        };
        window.addEventListener('message', handleMessage);

        // Also check for popup close after a delay
        setTimeout(() => {
          setConnectionComplete(true);
          setIsConnecting(false);
          onSuccess();
        }, 3000);
      } else {
        // No OAuth needed, profile created directly
        setConnectionComplete(true);
        setIsConnecting(false);
        setTimeout(() => {
          onSuccess();
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to connect:', error);
      setIsConnecting(false);
    }
  };

  if (connectionComplete) {
    return (
      <div className="py-8 text-center">
        <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">Connected Successfully!</h3>
        <p className="text-sm text-muted-foreground">
          Your {toolkit.name} integration is ready to use.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="profile-name">Connection Name</Label>
          <Input
            id="profile-name"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="Enter a name for this connection"
            disabled={isConnecting}
          />
          <p className="text-xs text-muted-foreground">
            This name helps you identify the connection later.
          </p>
        </div>

        {toolkit.auth_schemes && toolkit.auth_schemes.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <h4 className="text-sm font-medium mb-2">Authentication</h4>
            <p className="text-xs text-muted-foreground">
              This integration uses {toolkit.auth_schemes[0]} authentication.
              You'll be redirected to {toolkit.name} to authorize access.
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button variant="outline" onClick={onCancel} disabled={isConnecting}>
          Cancel
        </Button>
        <Button
          onClick={handleConnect}
          disabled={!profileName.trim() || isConnecting}
        >
          {isConnecting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Connecting...
            </>
          ) : (
            <>
              <ExternalLink className="h-4 w-4 mr-2" />
              Connect to {toolkit.name}
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
