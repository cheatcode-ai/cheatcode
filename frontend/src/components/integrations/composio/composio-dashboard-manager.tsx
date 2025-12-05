'use client';

import React, { useState, memo } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { Settings, Store, AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { ComposioRegistry } from './composio-registry';
import {
  useComposioProfiles,
  useUpdateCompositoDashboardDefault,
  useDeleteComposioProfile,
  composioKeys,
} from '@/hooks/react-query/composio';
import type { ComposioProfile } from '@/types/composio-profiles';
import { useComposioApi } from '@/hooks/react-query/composio/utils';

interface CompositoDashboardManagerProps {
  compact?: boolean;
}

function CompositoDashboardManagerComponent({ compact = false }: CompositoDashboardManagerProps) {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<ComposioProfile | null>(null);
  const [activeTab, setActiveTab] = useState('browse-apps');

  // Get Composio profiles
  const { data: profiles = [], isLoading, error } = useComposioProfiles();
  const updateDashboardDefault = useUpdateCompositoDashboardDefault();
  const deleteProfile = useDeleteComposioProfile();

  const handleToggle = async (profileId: string, currentValue: boolean) => {
    setIsUpdating(profileId);
    try {
      await updateDashboardDefault.mutateAsync({
        profileId,
        enabled: !currentValue
      });
      toast.success(currentValue ? 'Integration disabled for dashboard' : 'Integration enabled for dashboard');
    } catch (error) {
      console.error('Error updating dashboard preference:', error);
      toast.error('Failed to update integration preference');
    } finally {
      setIsUpdating(null);
    }
  };

  const handleDeleteClick = (profile: ComposioProfile) => {
    setProfileToDelete(profile);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!profileToDelete) return;

    try {
      await deleteProfile.mutateAsync(profileToDelete.profile_id);
      setDeleteDialogOpen(false);
      setProfileToDelete(null);
    } catch (error) {
      // Error is handled by the mutation onError
    }
  };

  const handleFixTools = async (profileId: string) => {
    try {
      await composioApi.updateEnabledTools(profileId, []);
      toast.success('Tools auto-enabled');
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
    } catch (error) {
      console.error('Error fixing tools:', error);
      toast.error('Failed to auto-enable tools');
    }
  };

  const enabledCount = profiles.filter((profile: ComposioProfile) => profile.is_default_for_dashboard).length;

  if (error) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-destructive mb-4">
          Failed to load integrations. Please try again.
        </p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl p-6 border animate-pulse">
          <div className="flex items-center justify-between mb-4">
            <div className="h-6 bg-muted rounded w-48"></div>
            <div className="flex gap-2">
              <div className="h-9 bg-muted rounded w-24"></div>
              <div className="h-9 bg-muted rounded w-24"></div>
            </div>
          </div>
          <div className="h-4 bg-muted rounded w-32"></div>
        </div>

        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center justify-between p-3 border rounded-lg animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-muted rounded-lg"></div>
                <div>
                  <div className="h-4 bg-muted rounded w-24 mb-1"></div>
                  <div className="h-3 bg-muted rounded w-16"></div>
                </div>
              </div>
              <div className="h-6 bg-muted rounded w-12"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with buttons */}
      <div className="relative overflow-hidden rounded-2xl border bg-card p-8 shadow-sm">
        <div className="relative">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start space-x-5">
              <div className="relative">
                <div className="p-3 bg-primary/10 rounded-xl border border-primary/20 shadow-sm">
                  <Settings className="h-6 w-6 text-primary" />
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">Integration Management</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-lg">
                    Enable your connected integrations for use in dashboard chats. All available tools are automatically enabled when you connect an app.
                  </p>
                </div>
                {enabledCount > 0 && (
                  <div className="flex items-center space-x-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-[0_0_6px_theme(colors.emerald.400),0_0_12px_theme(colors.emerald.400/0.8)]" />
                      <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                        {enabledCount} integration{enabledCount !== 1 ? 's' : ''} enabled for dashboard
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {/* Tab interface */}
            <div className="flex justify-center mt-6">
              <div
                className="relative inline-flex h-10 items-center rounded-full p-0.5 bg-muted ring-1 ring-border shadow-inner overflow-hidden"
                role="tablist"
                aria-label="Select integration type"
              >
                {/* Connected Integrations Button */}
                {profiles.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveTab('connected')}
                    role="tab"
                    aria-selected={activeTab === 'connected'}
                    className={cn(
                      'relative z-10 h-9 px-4 text-sm rounded-full transition-colors flex items-center gap-2',
                      activeTab === 'connected'
                        ? 'bg-zinc-900 text-white'
                        : 'text-gray-400 hover:text-white'
                    )}
                  >
                    <Settings className="h-4 w-4" />
                    Connected ({profiles.length})
                  </Button>
                )}

                {/* Browse Apps Button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab('browse-apps')}
                  role="tab"
                  aria-selected={activeTab === 'browse-apps'}
                  className={cn(
                    'relative z-10 h-9 px-4 text-sm rounded-full transition-colors flex items-center gap-2',
                    activeTab === 'browse-apps'
                      ? 'bg-zinc-900 text-white'
                      : 'text-gray-400 hover:text-white'
                  )}
                >
                  <Store className="h-4 w-4" />
                  Browse Apps
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="w-full">
        {/* Connected Integrations Tab */}
        {activeTab === 'connected' && profiles.length > 0 && (
          <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
            <div className="px-6 py-5 border-b border-border bg-muted">
              <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full" />
                Connected Integrations
              </h4>
            </div>
            <div className="p-3 space-y-1">
              {profiles.map((profile: ComposioProfile) => (
                <div key={profile.profile_id} className="p-4 hover:bg-muted rounded-xl transition-all duration-200 border border-border hover:border-primary/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                        profile.is_default_for_dashboard
                          ? 'bg-green-400 shadow-[0_0_6px_theme(colors.green.400),0_0_12px_theme(colors.green.400/0.8),0_0_18px_theme(colors.green.400/0.6)]'
                          : 'bg-gray-400 shadow-[0_0_4px_theme(colors.gray.400),0_0_8px_theme(colors.gray.400/0.6),0_0_12px_theme(colors.gray.400/0.4)]'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="font-medium text-sm truncate">{profile.display_name || profile.profile_name}</div>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{profile.enabled_tools?.length || 0} tools {profile.enabled_tools?.length === 0 ? 'available' : 'enabled'}</span>
                          {!profile.is_connected && (
                            <div className="flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3 text-amber-600" />
                              <span className="text-amber-600">Not connected</span>
                            </div>
                          )}
                          {profile.is_connected && (!profile.enabled_tools || profile.enabled_tools.length === 0) && (
                            <button
                              onClick={() => handleFixTools(profile.profile_id)}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                            >
                              Auto-enable tools
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteClick(profile)}
                        disabled={deleteProfile.isPending}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/20"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Switch
                        checked={profile.is_default_for_dashboard}
                        onCheckedChange={() => handleToggle(profile.profile_id, profile.is_default_for_dashboard)}
                        disabled={isUpdating === profile.profile_id || !profile.is_active || !profile.is_connected}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Browse Apps Tab */}
        {activeTab === 'browse-apps' && (
          <div className="border border-border rounded-xl p-4 bg-card">
            <ComposioRegistry />
          </div>
        )}

        {/* Empty state for Connected tab when no profiles */}
        {activeTab === 'connected' && profiles.length === 0 && (
          <div className="text-center py-12 border border-border rounded-xl bg-card">
            <div className="mx-auto w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mb-4 border border-border">
              <Settings className="h-8 w-8 text-muted-foreground" />
            </div>
            <h4 className="text-lg font-semibold text-foreground mb-2">
              No integrations connected
            </h4>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Use the "Browse Apps" tab to add your first integration.
            </p>
            <Button
              variant="outline"
              onClick={() => setActiveTab('browse-apps')}
              className="flex items-center gap-2"
            >
              <Store className="h-4 w-4" />
              Browse Apps
            </Button>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Integration</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove the <strong>{profileToDelete?.display_name || profileToDelete?.profile_name}</strong> integration?
              This will permanently delete the connection and all its configuration. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteProfile.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80"
            >
              {deleteProfile.isPending ? 'Removing...' : 'Remove Integration'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const CompositoDashboardManager = memo(CompositoDashboardManagerComponent);
