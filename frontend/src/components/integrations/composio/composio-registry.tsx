'use client';

/**
 * Composio Registry - Browse and connect to third-party apps via Composio.
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Loader2, CheckCircle2, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useComposioToolkits } from '@/hooks/react-query/composio';
import { useComposioProfiles } from '@/hooks/react-query/composio/use-composio-profiles';
import { ComposioConnectButton } from './composio-connect-button';
import { toast } from 'sonner';
import type { ComposioProfile, ComposioToolkit } from '@/types/composio-profiles';
import { useQueryClient } from '@tanstack/react-query';
import { composioKeys } from '@/hooks/react-query/composio/keys';

interface ComposioRegistryProps {
  onProfileSelected?: (profile: ComposioProfile) => void;
  onToolsSelected?: (
    profileId: string,
    selectedTools: string[],
    toolkitName: string,
    toolkitSlug: string
  ) => void;
}

export const ComposioRegistry: React.FC<ComposioRegistryProps> = ({
  onProfileSelected,
  onToolsSelected,
}) => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [selectedToolkit, setSelectedToolkit] = useState<ComposioToolkit | null>(null);

  const queryClient = useQueryClient();
  const {
    data: toolkitsData,
    isLoading,
    error,
    refetch,
  } = useComposioToolkits({
    search: search || undefined,
    category: selectedCategory || undefined,
  });
  const { data: profiles } = useComposioProfiles();

  const handleSearch = (value: string) => {
    setSearch(value);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    refetch();
  };

  const getToolkitProfiles = (toolkitSlug: string) => {
    return profiles?.filter((p) => p.toolkit_slug === toolkitSlug && p.is_active) || [];
  };

  const handleProfileSelect = (profileId: string | null, toolkit: ComposioToolkit) => {
    if (!profileId) return;

    const profile = profiles?.find((p) => p.profile_id === profileId);
    if (!profile) return;

    // Skip tool selection - use all tools from the MCP server directly
    // The MCP server exposes all available tools automatically
    onProfileSelected?.(profile);

    if (onToolsSelected) {
      // Pass empty array for tools - the MCP server will provide all tools
      // enabled_tools being empty means "use all available tools"
      onToolsSelected(
        profile.profile_id,
        profile.enabled_tools || [], // Use profile's enabled tools or all if empty
        profile.display_name || profile.profile_name,
        profile.toolkit_slug
      );
      toast.success(`Added ${toolkit.name} integration!`);
    }
  };

  const handleConnectToolkit = (toolkit: ComposioToolkit) => {
    setSelectedToolkit(toolkit);
    setShowConnectDialog(true);
  };

  const handleConnectSuccess = () => {
    setShowConnectDialog(false);
    setSelectedToolkit(null);
    queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
    toast.success(`Connected to ${selectedToolkit?.name}!`);
  };

  const ToolkitIcon: React.FC<{ toolkit: ComposioToolkit }> = ({ toolkit }) => {
    const [imageError, setImageError] = useState(false);

    if (imageError || !toolkit.icon_url) {
      return (
        <div className="h-12 w-12 rounded-lg flex items-center justify-center bg-primary/20 border border-border/50">
          <span className="text-primary font-semibold text-lg">
            {toolkit.name.charAt(0).toUpperCase()}
          </span>
        </div>
      );
    }

    return (
      <div className="h-12 w-12 rounded-lg flex items-center justify-center overflow-hidden bg-background shadow-sm border border-border/50">
        <img
          src={toolkit.icon_url}
          alt={`${toolkit.name} logo`}
          className="w-8 h-8 object-contain"
          onError={() => setImageError(true)}
        />
      </div>
    );
  };

  const ToolkitCard: React.FC<{ toolkit: ComposioToolkit }> = ({ toolkit }) => {
    const toolkitProfiles = getToolkitProfiles(toolkit.slug);
    const hasConnectedProfiles = toolkitProfiles.length > 0;
    const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

    return (
      <Card className="group transition-all duration-200 hover:shadow-lg border border-border hover:border-primary/20 bg-card hover:bg-card/95 h-full">
        <CardContent className="p-5 h-full">
          <div className="flex flex-col h-full">
            {/* Toolkit Icon and Name */}
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0">
                <ToolkitIcon toolkit={toolkit} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base text-foreground truncate leading-tight">
                  {toolkit.name}
                </h3>
                {toolkit.categories.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {toolkit.categories[0]}
                  </p>
                )}
              </div>
            </div>

            {/* Description */}
            <p className="text-sm text-muted-foreground line-clamp-2 mb-4 flex-1 leading-relaxed">
              {toolkit.description}
            </p>

            {/* Tool Count Badge */}
            {toolkit.tool_count > 0 && (
              <div className="mb-4">
                <Badge
                  variant="outline"
                  className="text-xs bg-muted/50 text-muted-foreground border-border"
                >
                  {toolkit.tool_count} tools available
                </Badge>
              </div>
            )}

            {/* Connection Status */}
            <div className="mt-auto">
              {hasConnectedProfiles ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="text-sm text-green-600 font-medium">Connected</span>
                  </div>
                  <select
                    value={selectedProfileId || ''}
                    onChange={(e) => {
                      const profileId = e.target.value;
                      setSelectedProfileId(profileId);
                      if (profileId) {
                        handleProfileSelect(profileId, toolkit);
                      }
                    }}
                    className="w-full h-9 text-sm rounded-md border border-input bg-background px-3 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Select profile...</option>
                    {toolkitProfiles.map((profile) => (
                      <option key={profile.profile_id} value={profile.profile_id}>
                        {profile.profile_name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                    <span className="text-sm text-muted-foreground">Not connected</span>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => handleConnectToolkit(toolkit)}
                    className="w-full h-9 text-sm font-medium"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Connect
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-500 mb-2">Failed to load Composio toolkits</div>
        <Button onClick={() => refetch()} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full max-h-[80vh]">
      <div className="flex flex-col h-full max-h-[calc(100vh-200px)]">
        <div className="p-6 border-b border-border bg-card">
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-2">Browse Integrations</h2>
            <p className="text-sm text-muted-foreground">
              Connect your favorite apps with your agent via Composio
            </p>
          </div>

          <form onSubmit={handleSearchSubmit} className="max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search integrations..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-10 h-11 bg-background border border-border focus:border-primary transition-colors"
              />
            </div>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-background">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading integrations...</span>
              </div>
            </div>
          )}

          {!isLoading && toolkitsData?.toolkits && toolkitsData.toolkits.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 max-w-full">
              {toolkitsData.toolkits.map((toolkit: ComposioToolkit) => (
                <ToolkitCard key={toolkit.slug} toolkit={toolkit} />
              ))}
            </div>
          )}

          {!isLoading && toolkitsData?.toolkits && toolkitsData.toolkits.length === 0 && (
            <div className="text-center py-12 bg-card border border-border rounded-lg mx-4">
              <div className="max-w-md mx-auto">
                <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No integrations found</h3>
                <p className="text-muted-foreground mb-6">
                  No integrations match your search criteria. Try adjusting your search terms.
                </p>
                <Button
                  onClick={() => {
                    setSearch('');
                    setSelectedCategory('');
                  }}
                  variant="default"
                  className="px-6"
                >
                  <Search className="h-4 w-4 mr-2" />
                  View All Integrations
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Connect Dialog */}
      <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect to {selectedToolkit?.name}</DialogTitle>
            <DialogDescription>
              Create a connection to {selectedToolkit?.name} to use its tools in your agent.
            </DialogDescription>
          </DialogHeader>
          {selectedToolkit && (
            <ComposioConnectButton
              toolkit={selectedToolkit}
              onSuccess={handleConnectSuccess}
              onCancel={() => setShowConnectDialog(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
