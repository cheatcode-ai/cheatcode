'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Zap, Settings, RefreshCw, CheckCircle2, AlertCircle, User, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { CredentialProfileSelector } from './credential-profile-selector';
import { CredentialProfileManager } from './credential-profile-manager';
import { usePipedreamProfiles } from '@/hooks/react-query/pipedream/use-pipedream-profiles';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { PipedreamProfile } from '@/types/pipedream-profiles';

interface PipedreamTool {
  name: string;
  description: string;
  inputSchema: any;
}

interface PipedreamApp {
  app_name: string;
  app_slug: string;
  tools: PipedreamTool[];
  tool_count: number;
  profile_id?: string;
}

interface PipedreamMCPConfigurationProps {
  onConfigurationChange: (config: any) => void;
  initialConfig?: any;
}

interface AppConfiguration {
  profileId: string;
  selectedTools: string[];
}

export const PipedreamMCPConfiguration: React.FC<PipedreamMCPConfigurationProps> = ({
  onConfigurationChange,
  initialConfig = {}
}) => {
  const [appConfigurations, setAppConfigurations] = useState<Record<string, AppConfiguration>>(
    initialConfig.appConfigurations || {}
  );
  const [showProfileManager, setShowProfileManager] = useState(false);
  const [managingApp, setManagingApp] = useState<{ slug: string; name: string } | null>(null);
  
  const { data: allProfiles, isLoading: isLoadingProfiles, refetch: refetchProfiles } = usePipedreamProfiles();

  // Group profiles by app
  const profilesByApp = useMemo(() => {
    const grouped: Record<string, PipedreamProfile[]> = {};
    
    allProfiles?.forEach(profile => {
      if (!grouped[profile.app_slug]) {
        grouped[profile.app_slug] = [];
      }
      grouped[profile.app_slug].push(profile);
    });
    
    return grouped;
  }, [allProfiles]);

  // Get connected apps with their profiles
  const connectedApps = useMemo(() => {
    const apps: PipedreamApp[] = [];
    
    Object.entries(profilesByApp).forEach(([appSlug, profiles]) => {
      const connectedProfiles = profiles.filter(p => p.is_connected);
      if (connectedProfiles.length > 0) {
        // Use the first connected profile's app name
        const appName = connectedProfiles[0].app_name;
        
        // For each connected profile, we can create an app entry
        connectedProfiles.forEach(profile => {
          apps.push({
            app_name: `${appName} (${profile.profile_name})`,
            app_slug: appSlug,
            tools: profile.enabled_tools.map(tool => ({
              name: tool,
              description: '',
              inputSchema: {}
            })),
            tool_count: profile.enabled_tools.length,
            profile_id: profile.profile_id
          });
        });
      }
    });
    
    return apps;
  }, [profilesByApp]);

  const customMcps = useMemo(() => {
    const mcps: any[] = [];
    
    Object.entries(appConfigurations).forEach(([profileId, config]) => {
      if (config.selectedTools.length > 0) {
        const profile = allProfiles?.find(p => p.profile_id === profileId);
        if (profile && profile.is_connected) {
          mcps.push({
            name: `${profile.app_name} (${profile.profile_name})`,
            qualifiedName: `pipedream_${profile.app_slug}_${profile.profile_id}`,
            config: {
              url: 'https://remote.mcp.pipedream.net',
              headers: {
                'x-pd-app-slug': profile.app_slug,
              },
              profile_id: profile.profile_id,
              app_slug: profile.app_slug,
            },
            enabledTools: config.selectedTools,
            isCustom: true,
            customType: 'pipedream',
            type: 'sse'
          });
        }
      }
    });
    
    return mcps;
  }, [appConfigurations, allProfiles]);

  const updateConfiguration = useCallback(() => {
    onConfigurationChange(customMcps);
  }, [customMcps, onConfigurationChange]);

  useEffect(() => {
    updateConfiguration();
  }, [updateConfiguration]);

  const handleToolToggle = useCallback((profileId: string, toolName: string) => {
    setAppConfigurations(prev => {
      const config = prev[profileId] || { profileId, selectedTools: [] };
      const updated = config.selectedTools.includes(toolName)
        ? config.selectedTools.filter(t => t !== toolName)
        : [...config.selectedTools, toolName];
      
      return {
        ...prev,
        [profileId]: { ...config, selectedTools: updated }
      };
    });
  }, []);

  const handleSelectAll = useCallback((app: PipedreamApp) => {
    if (!app.profile_id) return;
    
    const allToolNames = app.tools.map(t => t.name);
    setAppConfigurations(prev => ({
      ...prev,
      [app.profile_id!]: { profileId: app.profile_id!, selectedTools: allToolNames }
    }));
  }, []);

  const handleDeselectAll = useCallback((app: PipedreamApp) => {
    if (!app.profile_id) return;
    
    setAppConfigurations(prev => ({
      ...prev,
      [app.profile_id!]: { profileId: app.profile_id!, selectedTools: [] }
    }));
  }, []);

  const handleRefresh = useCallback(async () => {
    await refetchProfiles();
    toast.success('Refreshed credential profiles');
  }, [refetchProfiles]);

  if (isLoadingProfiles) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        <span>Loading credential profiles...</span>
      </div>
    );
  }

  const hasProfiles = allProfiles && allProfiles.length > 0;
  const totalSelectedTools = Object.values(appConfigurations).reduce(
    (total, config) => total + config.selectedTools.length, 
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl p-6 border bg-card">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-4">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-medium">Pipedream Integration</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Connect your apps through Pipedream credential profiles
              </p>
              {connectedApps.length > 0 && (
                <div className="flex items-center mt-3 space-x-4">
                  <Badge variant="secondary">
                    {connectedApps.length} profile{connectedApps.length !== 1 ? 's' : ''} connected
                  </Badge>
                  <Badge variant="outline">
                    {totalSelectedTools} tool{totalSelectedTools !== 1 ? 's' : ''} selected
                  </Badge>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={isLoadingProfiles}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={() => setShowProfileManager(true)}
            >
              <Settings className="h-4 w-4 mr-2" />
              Manage Profiles
            </Button>
          </div>
        </div>
      </div>

      {/* Connected Apps */}
      {!hasProfiles ? (
        <Card>
          <CardContent className="text-center py-12">
            <User className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="font-medium mb-2">No credential profiles yet</h4>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              Create credential profiles to connect your apps through Pipedream
            </p>
            <Button onClick={() => setShowProfileManager(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Profile
            </Button>
          </CardContent>
        </Card>
      ) : connectedApps.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <AlertCircle className="w-12 h-12 text-warning mx-auto mb-4" />
            <h4 className="font-medium mb-2">No connected profiles</h4>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              You have profiles but none are connected to Pipedream apps yet
            </p>
            <Button onClick={() => setShowProfileManager(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Manage Profiles
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {connectedApps.map((app: PipedreamApp) => {
            if (!app.profile_id) return null;
            
            const config = appConfigurations[app.profile_id] || { profileId: app.profile_id, selectedTools: [] };
            const appSelectedTools = config.selectedTools;
            const isAllSelected = appSelectedTools.length === app.tools.length;

            return (
              <Card key={app.profile_id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {app.app_name}
                        {appSelectedTools.length > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {appSelectedTools.length}/{app.tool_count} selected
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs mt-1">
                        {app.tool_count} tool{app.tool_count !== 1 ? 's' : ''} available
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSelectAll(app)}
                        disabled={isAllSelected || app.tools.length === 0}
                      >
                        Select All
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeselectAll(app)}
                        disabled={appSelectedTools.length === 0}
                      >
                        Deselect All
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {app.tools.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No tools available for this profile
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {app.tools.map((tool: PipedreamTool) => {
                        const isSelected = appSelectedTools.includes(tool.name);
                        return (
                          <div
                            key={tool.name}
                            className="flex items-start space-x-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
                          >
                            <Checkbox
                              id={`${app.profile_id}-${tool.name}`}
                              checked={isSelected}
                              onCheckedChange={() => handleToolToggle(app.profile_id!, tool.name)}
                              className="mt-0.5"
                            />
                            <label
                              htmlFor={`${app.profile_id}-${tool.name}`}
                              className="flex-1 cursor-pointer"
                            >
                              <div className="font-medium text-sm">{tool.name}</div>
                              {tool.description && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  {tool.description}
                                </div>
                              )}
                            </label>
                            {isSelected && (
                              <CheckCircle2 className="w-4 h-4 text-primary mt-0.5" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Profile Manager Dialog */}
      <Dialog open={showProfileManager} onOpenChange={setShowProfileManager}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Pipedream Profiles</DialogTitle>
            <DialogDescription>
              Create and manage credential profiles for your Pipedream apps
            </DialogDescription>
          </DialogHeader>
          <CredentialProfileManager
            onProfileSelect={(profile) => {
              // Refresh profiles after selection
              refetchProfiles();
              setShowProfileManager(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}; 