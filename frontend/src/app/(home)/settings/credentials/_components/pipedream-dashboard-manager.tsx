'use client';

import React, { useState, memo } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Zap, Settings, ExternalLink, Store, Server, AlertTriangle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClerkBackendApi } from '@/lib/api-client';
import { useAuth } from '@clerk/nextjs';
import { settingsKeys } from '@/hooks/react-query/settings/keys';
import { useRefetchControl } from '@/hooks/use-refetch-control';
import { useRouter } from 'next/navigation';
import { PipedreamRegistry } from '@/components/integrations/pipedream/pipedream-registry';
import { CustomMCPDialog } from './custom-mcp-dialog';

interface PipedreamProfile {
  profile_id: string;
  account_id: string;
  mcp_qualified_name: string;
  profile_name: string;
  display_name: string;
  is_active: boolean;
  is_default: boolean;
  is_default_for_dashboard: boolean;
  enabled_tools: string[];
  app_slug: string;
  app_name: string;
  is_connected: boolean;
}

interface PipedreamDashboardManagerProps {
  compact?: boolean;
}

function PipedreamDashboardManagerComponent({ compact = false }: PipedreamDashboardManagerProps) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<PipedreamProfile | null>(null);
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [showCustomMCPDialog, setShowCustomMCPDialog] = useState(false);
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();

  // Get Pipedream profiles from hydrated cache
  // OPTIMIZED: Reads from server-hydrated cache - NO network requests needed!
  const { data: profiles = [], isLoading, error } = useQuery({
    queryKey: settingsKeys.integrations.pipedream.profiles(),
    queryFn: async () => {
      console.log('[INTEGRATIONS] 🚨 FALLBACK: Server prefetch failed, using client-side API call');
      
      const apiClient = createClerkBackendApi(getToken);
      const response = await apiClient.get('/pipedream/profiles');
      
      console.log('[INTEGRATIONS] ✅ Fallback API call succeeded');
      return response.data || [];
    },
    enabled: true,
    staleTime: 5 * 60 * 1000, // 5 minutes - matches server prefetch
    retry: 2, // Allow retries for fallback scenario
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });

  // Auto-enable tools mutation
  const autoEnableTools = useMutation({
    mutationFn: async () => {
      const apiClient = createClerkBackendApi(getToken);
      return apiClient.post('/pipedream/auto-enable-all-tools');
    },
    onSuccess: (response) => {
      const { updated_profiles } = response.data;
      if (updated_profiles && updated_profiles.length > 0) {
        toast.success(`Auto-enabled tools for ${updated_profiles.length} integrations`);
        queryClient.invalidateQueries({ queryKey: ['pipedream-profiles'] });
      }
    },
    onError: (error) => {
      console.error('Error auto-enabling tools:', error);
      toast.error('Failed to auto-enable tools');
    }
  });

  console.log('Pipedream profiles:', profiles);

  // Auto-enable tools for profiles that don't have any tools on component load
  React.useEffect(() => {
    if (profiles && profiles.length > 0) {
      const profilesWithoutTools = profiles.filter(
        (profile: PipedreamProfile) => 
          profile.is_connected && 
          (!profile.enabled_tools || profile.enabled_tools.length === 0)
      );
      
      if (profilesWithoutTools.length > 0) {
        console.log(`Found ${profilesWithoutTools.length} profiles without tools, auto-enabling...`);
        autoEnableTools.mutate();
      }
    }
  }, [profiles, autoEnableTools]);

  // Update dashboard default mutation
  const updateDashboardDefault = useMutation({
    mutationFn: async ({ profileId, enabled }: { profileId: string, enabled: boolean }) => {
      const apiClient = createClerkBackendApi(getToken);
      return apiClient.put(`/pipedream/profiles/${profileId}`, {
        is_default_for_dashboard: enabled
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipedream-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['mcp-credential-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-mcp-configurations'] });
    }
  });

  // Delete profile mutation
  const deleteProfile = useMutation({
    mutationFn: async (profileId: string) => {
      const apiClient = createClerkBackendApi(getToken);
      return apiClient.delete(`/pipedream/profiles/${profileId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipedream-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['mcp-credential-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-mcp-configurations'] });
      toast.success('Integration removed successfully');
    },
    onError: (error) => {
      console.error('Error deleting profile:', error);
      toast.error('Failed to remove integration');
    }
  });

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

  const handleDeleteClick = (profile: PipedreamProfile) => {
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

  const handleProfileSelected = (profile: any) => {
    // Handle profile selection if needed
    console.log('Profile selected:', profile);
  };

  const handleToolsSelected = (profileId: string, selectedTools: string[], appName: string, appSlug: string) => {
    // Handle tools selection - could update the profile's enabled tools
    console.log('Tools selected:', { profileId, selectedTools, appName, appSlug });
    toast.success(`Selected ${selectedTools.length} tools from ${appName}`);
    setShowIntegrations(false);
  };

  const handleFixTools = async (profileId: string) => {
    try {
      const apiClient = createClerkBackendApi(getToken);
      const response = await apiClient.post(`/pipedream/profiles/${profileId}/auto-enable-tools`);
      
      if (response.data.success) {
        toast.success(response.data.message);
        queryClient.invalidateQueries({ queryKey: ['pipedream-profiles'] });
      }
    } catch (error) {
      console.error('Error fixing tools:', error);
      toast.error('Failed to auto-enable tools');
    }
  };

  const handleSaveCustomMCP = async (config: any) => {
    try {
      const api = createClerkBackendApi(getToken);
      
      // Create custom MCP profile
      const profileData = {
        mcp_qualified_name: `custom_${config.type}_${Date.now()}`,
        profile_name: config.name,
        display_name: config.name,
        config: config.config,
        enabled_tools: config.enabledTools,
        is_default_for_dashboard: true // Enable for dashboard by default
      };
      
      await api.post('/pipedream/profiles', profileData);
      
      // Refetch profiles to update UI
      await queryClient.invalidateQueries({
        queryKey: ['pipedream-profiles']
      });
      
      toast.success('Custom MCP connection created successfully');
      setShowCustomMCPDialog(false);
    } catch (error: any) {
      console.error('Error creating custom MCP:', error);
      toast.error(error.message || 'Failed to create custom MCP connection');
    }
  };

  const enabledCount = profiles.filter((profile: PipedreamProfile) => profile.is_default_for_dashboard).length;

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

  if (profiles.length === 0) {
    return (
      <div className="relative text-center py-20 px-8 bg-gradient-to-br from-card/50 via-card to-muted/20 rounded-2xl border border-border/30 shadow-lg">
        {/* Subtle background pattern */}
        <div className="absolute inset-0 opacity-20 rounded-2xl">
          <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:24px_24px]" />
        </div>
        
        <div className="relative">
          {/* Clean icon */}
          <div className="mx-auto w-20 h-20 bg-gradient-to-br from-primary/15 to-primary/5 rounded-2xl flex items-center justify-center mb-6 border border-primary/20 shadow-sm">
            <Zap className="h-10 w-10 text-primary" />
          </div>
          
          {/* Original content */}
          <h4 className="text-lg font-semibold text-foreground mb-3">
            No integrations configured
          </h4>
          <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto leading-relaxed">
            Connect your apps below to make them available for dashboard chats. All tools will be automatically enabled when you connect.
          </p>
          
          {/* Cleaner buttons */}
          <div className="flex gap-3 justify-center">
            <Button 
              onClick={() => setShowIntegrations(true)} 
              variant="default"
              size="lg"
              className="shadow-sm hover:shadow-md transition-shadow"
            >
              <Store className="h-4 w-4 mr-2" />
              Browse Apps
            </Button>
            <Button 
              onClick={() => setShowCustomMCPDialog(true)} 
              variant="outline"
              size="lg"
              className="shadow-sm hover:shadow-md transition-shadow"
            >
              <Server className="h-4 w-4 mr-2" />
              Custom MCP
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with buttons */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card to-muted/20 p-8 shadow-sm">
        <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:20px_20px]" />
        <div className="relative">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start space-x-5">
                             <div className="relative">
                 <div className="p-3 bg-gradient-to-br from-primary/20 to-primary/10 rounded-xl border border-primary/20 shadow-sm">
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
                {autoEnableTools.isPending && (
                  <div className="flex items-center space-x-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse shadow-[0_0_6px_theme(colors.blue.400)]" />
                      <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                        Auto-enabling tools for existing integrations...
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 flex-shrink-0">
              <Button
                size="default"
                variant="outline"
                onClick={() => setShowIntegrations(true)}
                className="h-10 px-4 bg-background/50 backdrop-blur-sm border-border/50 hover:bg-background/80 hover:border-primary/30 transition-all duration-300 shadow-sm"
              >
                <Store className="h-4 w-4 mr-2" />
                Browse Apps
              </Button>
              <Button
                size="default"
                variant="outline"
                onClick={() => setShowCustomMCPDialog(true)}
                className="h-10 px-4 bg-background/50 backdrop-blur-sm border-border/50 hover:bg-background/80 hover:border-primary/30 transition-all duration-300 shadow-sm"
              >
                <Server className="h-4 w-4 mr-2" />
                Custom MCP
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Configured integrations */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm bg-gradient-to-br from-card to-muted/10">
        <div className="px-6 py-5 border-b border-border/50 bg-gradient-to-r from-muted/40 to-muted/20 backdrop-blur-sm">
          <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
            <div className="w-2 h-2 bg-primary rounded-full" />
            Available Integrations
          </h4>
        </div>
        <div className="p-3 space-y-1">
          {profiles.map((profile: PipedreamProfile) => (
            <div key={profile.profile_id} className="p-4 hover:bg-muted/30 rounded-xl transition-all duration-200 border border-transparent hover:border-border/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    profile.is_default_for_dashboard 
                      ? 'bg-green-400 shadow-[0_0_6px_theme(colors.green.400),0_0_12px_theme(colors.green.400/0.8),0_0_18px_theme(colors.green.400/0.6)]' 
                      : 'bg-gray-400 shadow-[0_0_4px_theme(colors.gray.400),0_0_8px_theme(colors.gray.400/0.6),0_0_12px_theme(colors.gray.400/0.4)]'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="font-medium text-sm truncate">{profile.display_name}</div>
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
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
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

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Integration</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove the <strong>{profileToDelete?.display_name}</strong> integration? 
              This will permanently delete the connection and all its configuration. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteConfirm}
              disabled={deleteProfile.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteProfile.isPending ? 'Removing...' : 'Remove Integration'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Integrations Dialog */}
      <Dialog open={showIntegrations} onOpenChange={setShowIntegrations}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Browse Integrations</DialogTitle>
            <DialogDescription>
              Browse and connect apps to make them available for dashboard chats
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-auto flex-1">
            <PipedreamRegistry
              onProfileSelected={handleProfileSelected}
              onToolsSelected={handleToolsSelected}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Custom MCP Dialog */}
      <CustomMCPDialog
        open={showCustomMCPDialog}
        onOpenChange={setShowCustomMCPDialog}
        onSave={handleSaveCustomMCP}
      />
    </div>
  );
}

export const PipedreamDashboardManager = memo(PipedreamDashboardManagerComponent); 