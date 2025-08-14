'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';
import { 
  AlertCircle, 
  Settings,
  User,
  Plus,
} from 'lucide-react';
import { usePipedreamProfiles } from '@/hooks/react-query/pipedream/use-pipedream-profiles';
import { CredentialProfileManager } from '@/components/integrations/pipedream/credential-profile-manager';
import { PipedreamAppBrowser } from '@/components/integrations/pipedream/pipedream-app-browser';
import { useQueryClient } from '@tanstack/react-query';
import { pipedreamKeys } from '@/hooks/react-query/pipedream/keys';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PipedreamProfile } from '@/types/pipedream-profiles';

interface AppTableProps {
  appSlug: string;
  appName: string;
  profiles: PipedreamProfile[];
  onManageProfile: (profile: PipedreamProfile) => void;
}

const AppTable: React.FC<AppTableProps> = ({ appSlug, appName, profiles, onManageProfile }) => {
  const getAppLogoUrl = (appSlug: string) => {
    const logoSlug = appSlug.toLowerCase().replace(/_/g, '-');
    return `https://logo.clearbit.com/${logoSlug}.com`;
  };

  const columns: DataTableColumn<PipedreamProfile>[] = [
    {
      id: 'name',
      header: 'Profile Name',
      width: 'w-1/2',
      cell: (profile) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{profile.profile_name}</span>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-1/4',
      cell: (profile) => (
        <div className="flex items-center gap-2">
          {profile.is_connected ? (
            <div className="text-xs flex items-center gap-2">
              <div className="h-2 w-2 bg-green-500 rounded-full" />
              Connected
            </div>
          ) : (
            <div className="text-xs flex items-center gap-2">
              <div className="h-2 w-2 bg-red-500 rounded-full" />
              Not connected
            </div>
          )}
          {!profile.is_active && (
            <Badge variant="destructive" className="text-xs">
              Inactive
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      width: 'w-1/4',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (profile) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onManageProfile(profile);
          }}
          className="h-7 text-xs"
        >
          <Settings className="h-3 w-3" />
          Manage
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 rounded-lg flex items-center justify-center overflow-hidden bg-muted/50">
            <img
              src={getAppLogoUrl(appSlug)}
              alt={`${appName} logo`}
              className="w-full h-full object-contain"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent && !parent.querySelector('.fallback-logo')) {
                  const fallback = document.createElement('div');
                  fallback.className = 'fallback-logo w-6 h-6 rounded-lg bg-primary/20 flex items-center justify-center text-primary font-semibold text-xs';
                  fallback.textContent = appName.charAt(0).toUpperCase();
                  parent.appendChild(fallback);
                }
              }}
            />
          </div>
          <div>
            <h3 className="font-semibold text-md">{appName}</h3>
          </div>
        </div>
      </div>
      
      <DataTable
        columns={columns}
        data={profiles}
        emptyMessage={`No ${appName} profiles found`}
        className="bg-card border rounded-lg"
      />
    </div>
  );
};

interface PipedreamConnectionsSectionProps {
  onConnectNewApp?: (app: { app_slug: string; app_name: string }) => void;
}

export const PipedreamConnectionsSection: React.FC<PipedreamConnectionsSectionProps> = ({
  onConnectNewApp
}) => {
  const [showProfileManager, setShowProfileManager] = useState(false);
  const [showAppBrowser, setShowAppBrowser] = useState(false);
  const [selectedAppForProfile, setSelectedAppForProfile] = useState<{ app_slug: string; app_name: string } | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<PipedreamProfile | null>(null);
  const queryClient = useQueryClient();
  const { data: profiles, isLoading, error } = usePipedreamProfiles();

  const handleAppSelect = (app: { app_slug: string; app_name: string }) => {
    setShowAppBrowser(false);
    setSelectedAppForProfile(app);
    if (onConnectNewApp) {
      onConnectNewApp(app);
    }
    setShowProfileManager(true);
  };

  const handleManageProfile = (profile: PipedreamProfile) => {
    setSelectedProfile(profile);
    setSelectedAppForProfile({ app_slug: profile.app_slug, app_name: profile.app_name });
    setShowProfileManager(true);
  };

  const handleProfileManagerClose = () => {
    setShowProfileManager(false);
    setSelectedAppForProfile(null);
    setSelectedProfile(null);
    queryClient.invalidateQueries({ queryKey: pipedreamKeys.profiles.all() });
  };

  const profilesByApp = profiles?.reduce((acc, profile) => {
    const key = profile.app_slug;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(profile);
    return acc;
  }, {} as Record<string, PipedreamProfile[]>) || {};

  const totalProfiles = profiles?.length || 0;
  const connectedProfiles = profiles?.filter(p => p.is_connected).length || 0;
  const uniqueApps = Object.keys(profilesByApp).length;

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <div className="rounded-md border">
                <div className="p-4 space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load credential profiles. Please try again.
          </AlertDescription>
        </Alert>
      ) : totalProfiles === 0 ? (
        <Card className="border-dashed border-border/60 bg-muted/20">
          <CardContent className="p-8 text-center">
            <div className="space-y-4">
              <div className="p-3 rounded-full bg-blue-500/10 w-fit mx-auto">
                <User className="h-6 w-6 text-blue-500" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-foreground">No credential profiles yet</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Connect your favorite apps to create credential profiles for your agents
                </p>
              </div>
              <Button 
                onClick={() => setShowAppBrowser(true)}
                className="h-9"
              >
                <Plus className="h-4 w-4 mr-2" />
                Connect New App
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              onClick={() => setShowAppBrowser(true)}
            >
              <Plus className="h-4 w-4" />
              Connect New App
            </Button>
          </div>
          <div className="space-y-8">
            {Object.entries(profilesByApp)
              .sort(([, a], [, b]) => b.length - a.length)
              .map(([appSlug, appProfiles]) => (
                <AppTable
                  key={appSlug}
                  appSlug={appSlug}
                  appName={appProfiles[0].app_name}
                  profiles={appProfiles}
                  onManageProfile={handleManageProfile}
                />
              ))}
          </div>
        </div>
      )}

      <PipedreamAppBrowser
        open={showAppBrowser}
        onOpenChange={setShowAppBrowser}
        onSelectApp={handleAppSelect}
      />

      <Dialog open={showProfileManager} onOpenChange={handleProfileManagerClose}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedAppForProfile 
                ? `Manage ${selectedAppForProfile.app_name} Profiles`
                : 'Manage Pipedream Profiles'
              }
            </DialogTitle>
            <DialogDescription>
              {selectedAppForProfile
                ? `Create and manage credential profiles for ${selectedAppForProfile.app_name}`
                : 'Create and manage credential profiles for your Pipedream apps'
              }
            </DialogDescription>
          </DialogHeader>
          <CredentialProfileManager
            appSlug={selectedAppForProfile?.app_slug}
            appName={selectedAppForProfile?.app_name}
            onProfileSelect={() => {
              queryClient.invalidateQueries({ queryKey: pipedreamKeys.profiles.all() });
              handleProfileManagerClose();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}; 