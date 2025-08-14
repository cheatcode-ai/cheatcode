'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  User,
  Plus,
  CheckCircle2,
  XCircle,
  Star,
  Loader2,
  Settings,
  AlertCircle,
} from 'lucide-react';
import { usePipedreamProfiles } from '@/hooks/react-query/pipedream/use-pipedream-profiles';
import { CredentialProfileManager } from './credential-profile-manager';
import type { PipedreamProfile } from '@/types/pipedream-profiles';

interface CredentialProfileSelectorProps {
  appSlug: string;
  appName: string;
  selectedProfileId?: string;
  onProfileSelect: (profileId: string | null) => void;
  className?: string;
  showCreateOption?: boolean;
}

export const CredentialProfileSelector: React.FC<CredentialProfileSelectorProps> = ({
  appSlug,
  appName,
  selectedProfileId,
  onProfileSelect,
  className,
  showCreateOption = true,
}) => {
  const [showProfileManager, setShowProfileManager] = useState(false);
  const { data: profiles, isLoading } = usePipedreamProfiles({ app_slug: appSlug, is_active: true });

  // Removed automatic default profile selection to avoid unintended dialog pop-ups.

  const selectedProfile = profiles?.find(p => p.profile_id === selectedProfileId);
  const connectedProfiles = profiles?.filter(p => p.is_connected) || [];

  if (isLoading) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Loading profiles...</span>
        </div>
      </div>
    );
  }

  if (!profiles || profiles.length === 0) {
    return (
      <div className={className}>
        <Card>
          <CardContent className="py-6">
            <div className="text-center">
              <User className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-3">
                No credential profiles found for {appName}
              </p>
              {showCreateOption && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowProfileManager(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Profile
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {showProfileManager && (
          <Dialog open={showProfileManager} onOpenChange={setShowProfileManager}>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Manage {appName} Profiles</DialogTitle>
                <DialogDescription>
                  Create and manage credential profiles for {appName}.
                </DialogDescription>
              </DialogHeader>
              <CredentialProfileManager
                appSlug={appSlug}
                appName={appName}
                onProfileSelect={(profile) => {
                  onProfileSelect(profile.profile_id);
                  setShowProfileManager(false);
                }}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>
    );
  }

  if (connectedProfiles.length === 0) {
    return (
      <div className={className}>
        <Card>
          <CardContent className="py-6">
            <div className="text-center">
              <AlertCircle className="h-8 w-8 text-warning mx-auto mb-3" />
              <p className="text-sm font-medium mb-1">No Connected Profiles</p>
              <p className="text-sm text-muted-foreground mb-3">
                You have profiles but none are connected to {appName}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowProfileManager(true)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Manage Profiles
              </Button>
            </div>
          </CardContent>
        </Card>

        {showProfileManager && (
          <Dialog open={showProfileManager} onOpenChange={setShowProfileManager}>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Manage {appName} Profiles</DialogTitle>
                <DialogDescription>
                  Connect your profiles to use them with agents.
                </DialogDescription>
              </DialogHeader>
              <CredentialProfileManager
                appSlug={appSlug}
                appName={appName}
                onProfileSelect={(profile) => {
                  onProfileSelect(profile.profile_id);
                  setShowProfileManager(false);
                }}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="space-y-2">
        <div className="flex gap-2">
          <Select
            value={selectedProfileId || ''}
            onValueChange={(value) => onProfileSelect(value || null)}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select a profile">
                {selectedProfile && (
                  <div className="flex items-center gap-2">
                    <span>{selectedProfile.profile_name}</span>
                    {selectedProfile.is_default && (
                      <Star className="h-3 w-3 text-yellow-500" />
                    )}
                    {selectedProfile.is_connected ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-500" />
                    )}
                  </div>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {connectedProfiles.map((profile) => (
                <SelectItem key={profile.profile_id} value={profile.profile_id}>
                  <div className="flex items-center gap-2">
                    <span>{profile.profile_name}</span>
                    <div className="text-xs flex items-center gap-2">
                      <div className="h-2 w-2 bg-green-500 rounded-full" />
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showCreateOption && (
            <Button
              size="icon"
              variant="outline"
              onClick={() => setShowProfileManager(true)}
              title="Add new profile"
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>
        
        {selectedProfile && !selectedProfile.is_connected && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            This profile is not connected. Please connect it first.
          </p>
        )}
      </div>

      {showProfileManager && (
        <Dialog open={showProfileManager} onOpenChange={setShowProfileManager}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Manage {appName} Profiles</DialogTitle>
              <DialogDescription>
                Create and manage credential profiles for {appName}.
              </DialogDescription>
            </DialogHeader>
            <CredentialProfileManager
              appSlug={appSlug}
              appName={appName}
              onProfileSelect={(profile) => {
                onProfileSelect(profile.profile_id);
                setShowProfileManager(false);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}; 