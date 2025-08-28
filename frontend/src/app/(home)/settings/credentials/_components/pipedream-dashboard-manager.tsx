'use client';

import React, { useState, memo } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
// Tabs component removed - using custom iOS/Android style selector
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { Zap, Settings, ExternalLink, Store, Server, AlertTriangle, Trash2, Globe, Shield, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClerkBackendApi } from '@/lib/api-client';
import { useAuth } from '@clerk/nextjs';
import { settingsKeys } from '@/hooks/react-query/settings/keys';
import { useRefetchControl } from '@/hooks/use-refetch-control';
import { useRouter } from 'next/navigation';
import { PipedreamRegistry } from '@/components/integrations/pipedream/pipedream-registry';
// CustomMCPDialog import removed - using inline content in tabs instead
import { cn } from '@/lib/utils';
import type { PipedreamProfile } from '@/types/pipedream-profiles';

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
  const [activeTab, setActiveTab] = useState('browse-apps');
  
  // Custom MCP form state
  const [customServerType, setCustomServerType] = useState<'sse' | 'http' | 'json'>('sse');
  const [customMCPFormData, setCustomMCPFormData] = useState<{
    profile_name: string;
    display_name: string;
    config: Record<string, string>;
    is_default: boolean;
  }>({
    profile_name: '',
    display_name: '',
    config: {},
    is_default: false
  });
  const [isCreatingCustomMCP, setIsCreatingCustomMCP] = useState(false);
  // Refetch control disabled for better responsiveness
  // const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();

  // Get Pipedream profiles - CACHING DISABLED FOR RESPONSIVENESS
  const { data: profiles = [], isLoading, error } = useQuery({
    queryKey: settingsKeys.integrations.pipedream.profiles(),
    queryFn: async () => {
      console.log('[INTEGRATIONS] Fetching profiles with no cache');
      
      const apiClient = createClerkBackendApi(getToken);
      const response = await apiClient.get('/pipedream/profiles');
      
      console.log('[INTEGRATIONS] ✅ Direct API call succeeded');
      return response.data || [];
    },
    enabled: true,
    staleTime: 0, // No caching
    gcTime: 0, // No garbage collection time
    retry: 1, // Minimal retries
    refetchOnWindowFocus: false, // Disable all auto-refetching
    refetchOnMount: true, // Always fetch fresh on mount
    refetchOnReconnect: false,
    refetchInterval: false,
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

  // Keep Browse Apps as default tab - removed auto-switching behavior

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
    // Integration will be added and the component will re-render showing the profiles list
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

  // Custom MCP form helpers
  const handleCustomMCPConfigChange = (key: string, value: string) => {
    setCustomMCPFormData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        [key]: value
      }
    }));
  };

  const isCustomMCPFormValid = () => {
    if (!customMCPFormData.profile_name.trim() || !customMCPFormData.display_name.trim()) {
      return false;
    }
    
    if (customServerType === 'json') {
      return !!customMCPFormData.config.command;
    } else {
      return !!customMCPFormData.config.url;
    }
  };

  const resetCustomMCPForm = () => {
    setCustomServerType('sse');
    setCustomMCPFormData({
      profile_name: '',
      display_name: '',
      config: {},
      is_default: false
    });
  };

  const handleSaveCustomMCP = async () => {
    if (!isCustomMCPFormValid()) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsCreatingCustomMCP(true);
    try {
      const api = createClerkBackendApi(getToken);
      
      // Create custom MCP profile
      const profileData = {
        mcp_qualified_name: `custom_${customServerType}_${customMCPFormData.display_name.toLowerCase().replace(/\s+/g, '_')}`,
        profile_name: customMCPFormData.profile_name,
        display_name: customMCPFormData.display_name,
        config: customMCPFormData.config,
        enabled_tools: [], // Will be populated later
        is_default_for_dashboard: true // Enable for dashboard by default
      };
      
      await api.post('/pipedream/profiles', profileData);
      
      // Refetch profiles to update UI
      await queryClient.invalidateQueries({
        queryKey: ['pipedream-profiles']
      });
      
      toast.success('Custom MCP connection created successfully');
      resetCustomMCPForm();
      // Custom MCP will be added and the component will re-render showing the profiles list
    } catch (error: any) {
      console.error('Error creating custom MCP:', error);
      toast.error(error.message || 'Failed to create custom MCP connection');
    } finally {
      setIsCreatingCustomMCP(false);
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

  // Always show tab interface
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
            {/* Tab interface for all states */}
            <div className="flex justify-center mt-6">
              <div
                className="relative inline-flex h-10 items-center rounded-full p-0.5 bg-zinc-800/70 ring-1 ring-white/10 backdrop-blur-md shadow-inner overflow-hidden"
                role="tablist"
                aria-label="Select integration type"
              >
                {/* Connected Integrations Button - only show if profiles exist */}
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

                {/* Custom MCP Button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab('custom-mcp')}
                  role="tab"
                  aria-selected={activeTab === 'custom-mcp'}
                  className={cn(
                    'relative z-10 h-9 px-4 text-sm rounded-full transition-colors flex items-center gap-2',
                    activeTab === 'custom-mcp'
                      ? 'bg-zinc-900 text-white'
                      : 'text-gray-400 hover:text-white'
                  )}
                >
                  <Server className="h-4 w-4" />
                  Custom MCP
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
          <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm bg-gradient-to-br from-card to-muted/10">
            <div className="px-6 py-5 border-b border-border/50 bg-gradient-to-r from-muted/40 to-muted/20 backdrop-blur-sm">
              <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full" />
                Connected Integrations
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
        )}

        {/* Browse Apps Tab */}
        {activeTab === 'browse-apps' && (
          <div className="border border-border/50 rounded-xl p-4 bg-background/50">
            <PipedreamRegistry
              onProfileSelected={handleProfileSelected}
              onToolsSelected={handleToolsSelected}
            />
          </div>
        )}
        
        {/* Custom MCP Tab */}
        {activeTab === 'custom-mcp' && (
          <div className="border border-border/50 rounded-xl p-6 bg-background/50">
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
                <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center">
                  <Globe className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">Custom MCP Server</h3>
                  <p className="text-sm text-muted-foreground">Configure your own MCP server connection</p>
                </div>
              </div>

              {/* Form */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="custom_profile_name">Profile Name *</Label>
                    <Input
                      id="custom_profile_name"
                      value={customMCPFormData.profile_name}
                      onChange={(e) => setCustomMCPFormData(prev => ({ ...prev, profile_name: e.target.value }))}
                      placeholder="Enter a profile name (e.g., 'My Custom Server')"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="custom_display_name">Display Name *</Label>
                    <Input
                      id="custom_display_name"
                      value={customMCPFormData.display_name}
                      onChange={(e) => setCustomMCPFormData(prev => ({ ...prev, display_name: e.target.value }))}
                      placeholder="Enter a display name for this server"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="server_type">Server Type *</Label>
                  <Select value={customServerType} onValueChange={(value: 'sse' | 'http' | 'json') => setCustomServerType(value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select server type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sse">SSE (Server-Sent Events)</SelectItem>
                      <SelectItem value="http">HTTP</SelectItem>
                      <SelectItem value="json">JSON/stdio</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Choose the connection type for your MCP server
                  </p>
                </div>

                {customServerType === 'json' ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="server_command">Command *</Label>
                      <Input
                        id="server_command"
                        value={customMCPFormData.config.command || ''}
                        onChange={(e) => handleCustomMCPConfigChange('command', e.target.value)}
                        placeholder="Enter the command to start your MCP server (e.g., 'node server.js')"
                      />
                      <p className="text-xs text-muted-foreground">
                        The command to execute your MCP server
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="server_args">Arguments (optional)</Label>
                      <Input
                        id="server_args"
                        value={customMCPFormData.config.args || ''}
                        onChange={(e) => handleCustomMCPConfigChange('args', e.target.value)}
                        placeholder="Enter command arguments (comma-separated)"
                      />
                      <p className="text-xs text-muted-foreground">
                        Additional arguments for the command (separated by commas)
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="server_url">Server URL *</Label>
                    <Input
                      id="server_url"
                      type="url"
                      value={customMCPFormData.config.url || ''}
                      onChange={(e) => handleCustomMCPConfigChange('url', e.target.value)}
                      placeholder={`Enter your ${customServerType.toUpperCase()} server URL`}
                    />
                    <p className="text-xs text-muted-foreground">
                      The URL to your custom MCP server endpoint
                    </p>
                  </div>
                )}

                <Alert>
                  <Globe className="h-4 w-4" />
                  <AlertDescription>
                    This will create a custom MCP server profile that you can use in your agents. 
                    Make sure your server is accessible and properly configured.
                  </AlertDescription>
                </Alert>

                <Alert>
                  <Shield className="h-4 w-4" />
                  <AlertDescription>
                    Your server configuration will be encrypted and stored securely. You can create multiple profiles for different custom servers.
                  </AlertDescription>
                </Alert>

                {/* Action buttons */}
                <div className="flex items-center justify-between pt-4 border-t">
                  <Button variant="outline" onClick={resetCustomMCPForm}>
                    Reset Form
                  </Button>
                  <Button 
                    onClick={handleSaveCustomMCP}
                    disabled={!isCustomMCPFormValid() || isCreatingCustomMCP}
                  >
                    {isCreatingCustomMCP ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Creating...
                      </>
                    ) : (
                      'Create Connection'
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Empty state for Connected tab when no profiles */}
        {activeTab === 'connected' && profiles.length === 0 && (
          <div className="text-center py-12 border border-border/50 rounded-xl bg-background/50">
            <div className="mx-auto w-16 h-16 bg-gradient-to-br from-muted/40 to-muted/20 rounded-2xl flex items-center justify-center mb-4 border border-border/30">
              <Settings className="h-8 w-8 text-muted-foreground" />
            </div>
            <h4 className="text-lg font-semibold text-foreground mb-2">
              No integrations connected
            </h4>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Use the "Browse Apps" or "Custom MCP" tabs to add your first integration.
            </p>
            <div className="flex gap-2 justify-center">
              <Button 
                variant="outline" 
                onClick={() => setActiveTab('browse-apps')}
                className="flex items-center gap-2"
              >
                <Store className="h-4 w-4" />
                Browse Apps
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setActiveTab('custom-mcp')}
                className="flex items-center gap-2"
              >
                <Server className="h-4 w-4" />
                Custom MCP
              </Button>
            </div>
          </div>
        )}
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

      {/* Dialogs removed - using tabs in empty state instead */}
    </div>
  );
}

export const PipedreamDashboardManager = memo(PipedreamDashboardManagerComponent); 