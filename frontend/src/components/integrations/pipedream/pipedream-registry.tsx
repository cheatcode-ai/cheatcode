import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Loader2, ExternalLink, Zap, Filter, Grid, List, User, CheckCircle2, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { usePipedreamApps } from '@/hooks/react-query/pipedream/use-pipedream';
import { usePipedreamProfiles } from '@/hooks/react-query/pipedream/use-pipedream-profiles';
import { CredentialProfileSelector } from './credential-profile-selector';
import { PipedreamToolSelector } from './pipedream-tool-selector';
import { CredentialProfileManager } from './credential-profile-manager';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { PipedreamProfile } from '@/types/pipedream-profiles';
import { useQueryClient } from '@tanstack/react-query';
import { pipedreamKeys } from '@/hooks/react-query/pipedream/keys';

interface PipedreamApp {
  id: string;
  name: string;
  name_slug: string;
  app_hid: string;
  description: string;
  categories: string[];
  featured_weight: number;
  api_docs_url: string | null;
  status: number;
}

interface PipedreamRegistryProps {
  onProfileSelected?: (profile: PipedreamProfile) => void;
  onToolsSelected?: (profileId: string, selectedTools: string[], appName: string, appSlug: string) => void;
}

export const PipedreamRegistry: React.FC<PipedreamRegistryProps> = ({
  onProfileSelected,
  onToolsSelected
}) => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showToolSelector, setShowToolSelector] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<PipedreamProfile | null>(null);
  const [showProfileManager, setShowProfileManager] = useState(false);
  const [selectedAppForProfile, setSelectedAppForProfile] = useState<{ app_slug: string; app_name: string } | null>(null);

  const queryClient = useQueryClient();
  const { data: appsData, isLoading, error, refetch } = usePipedreamApps(page, search, selectedCategory);
  const { data: profiles } = usePipedreamProfiles();
  
  const { data: allAppsData } = usePipedreamApps(1, '', '');

  const categories = useMemo(() => {
    const dataToUse = allAppsData?.apps || appsData?.apps || [];
    const categorySet = new Set<string>();
    dataToUse.forEach((app: PipedreamApp) => {
      app.categories.forEach(cat => categorySet.add(cat));
    });
    return Array.from(categorySet).sort();
  }, [allAppsData?.apps, appsData?.apps]);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    refetch();
  };

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category === selectedCategory ? '' : category);
    setPage(1);
  };

  const handleProfileSelect = async (profileId: string | null, app: PipedreamApp) => {
    if (!profileId) return;
    
    const profile = profiles?.find(p => p.profile_id === profileId);
    if (!profile) return;

    if (!profile.is_connected) {
      toast.error('Please connect this profile first');
      return;
    }

    setSelectedProfile(profile);
    setShowToolSelector(true);
    onProfileSelected?.(profile);
  };

  const handleToolsSelected = (selectedTools: string[]) => {
    if (selectedProfile && onToolsSelected) {
      onToolsSelected(selectedProfile.profile_id, selectedTools, selectedProfile.app_name, selectedProfile.app_slug);
      setShowToolSelector(false);
      setSelectedProfile(null);
      toast.success(`Added ${selectedTools.length} tools from ${selectedProfile.app_name}!`);
    }
  };

  const handleCreateProfile = (app: PipedreamApp) => {
    setSelectedAppForProfile({ app_slug: app.name_slug, app_name: app.name });
    setShowProfileManager(true);
  };

  const handleProfileManagerClose = () => {
    setShowProfileManager(false);
    setSelectedAppForProfile(null);
    queryClient.invalidateQueries({ queryKey: pipedreamKeys.profiles.all() });
  };

  const getAppLogoUrl = (app: PipedreamApp) => {
    const logoSlug = app.name_slug.toLowerCase();
    return `https://logo.clearbit.com/${logoSlug}.com`;
  };

  const getAppProfiles = (appSlug: string) => {
    return profiles?.filter(p => p.app_slug === appSlug && p.is_active) || [];
  };

  const AppCard: React.FC<{ app: PipedreamApp }> = ({ app }) => {
    const appProfiles = getAppProfiles(app.name_slug);
    const connectedProfiles = appProfiles.filter(p => p.is_connected);
    const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

    return (
      <Card className="group transition-all duration-200 border-border/50 hover:border-border">
        <CardContent>
          <div className="flex flex-col items-start gap-2.5">
            <div className="flex-shrink-0">
              <div className='h-8 w-8 rounded-md flex items-center justify-center overflow-hidden'>
                <img
                  src={getAppLogoUrl(app)}
                  alt={`${app.name} logo`}
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent && !parent.querySelector('.fallback-logo')) {
                      const fallback = document.createElement('div');
                      fallback.className = 'fallback-logo w-6 h-6 rounded bg-primary/20 flex items-center justify-center text-primary font-semibold text-xs';
                      fallback.textContent = app.name.charAt(0).toUpperCase();
                      parent.appendChild(fallback);
                    }
                  }}
                />
              </div>
            </div>
            <div className="flex-1 min-w-0 w-full">
              <div className="flex items-start justify-between mb-1.5">
                <h3 className="font-medium text-sm truncate pr-2">{app.name}</h3>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                {app.description}
              </p>

              {app.categories.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {app.categories.slice(0, 2).map((category) => (
                    <Badge 
                      key={category} 
                      variant="outline" 
                      className="text-xs px-1.5 py-0.5 bg-muted/50 hover:bg-muted cursor-pointer h-5"
                      onClick={() => handleCategorySelect(category)}
                    >
                      {category}
                    </Badge>
                  ))}
                  {app.categories.length > 2 && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0.5 bg-muted/50 h-5">
                      +{app.categories.length - 2}
                    </Badge>
                  )}
                </div>
              )}

              {connectedProfiles.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <User className="h-3 w-3" />
                    <span>{connectedProfiles.length} profile{connectedProfiles.length !== 1 ? 's' : ''} connected</span>
                  </div>
                  <CredentialProfileSelector
                    appSlug={app.name_slug}
                    appName={app.name}
                    selectedProfileId={selectedProfileId}
                    onProfileSelect={(profileId) => {
                      setSelectedProfileId(profileId);
                      if (profileId) {
                        handleProfileSelect(profileId, app);
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    No profiles connected for this app
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCreateProfile(app)}
                    className="h-7 text-xs w-full"
                  >
                    <Plus className="h-3 w-3" />
                    Add Profile
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
        <div className="text-red-500 mb-2">Failed to load Pipedream apps</div>
        <Button onClick={() => refetch()} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full max-h-[80vh]">
      <div className="w-56 border-r border-border bg-muted/20 flex flex-col">
        <div className="p-3 border-b border-border">
          <div className="space-y-0.5">
            <button
              onClick={() => handleCategorySelect('')}
              className={cn(
                "w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors",
                selectedCategory === '' 
                  ? "bg-muted-foreground/20 text-muted-foreground" 
                  : "hover:bg-muted"
              )}
            >
              All Apps
              {(allAppsData?.total_count || appsData?.total_count) && (
                <span className="ml-1 opacity-70">
                  ({(allAppsData?.total_count || appsData?.total_count)?.toLocaleString()})
                </span>
              )}
            </button>
            {categories.map((category) => {
              const categoryCount = (allAppsData?.apps || appsData?.apps || []).filter((app: PipedreamApp) => 
                app.categories.includes(category)
              ).length;
              return (
                <button
                  key={category}
                  onClick={() => handleCategorySelect(category)}
                  className={cn(
                    "w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors",
                    selectedCategory === category 
                      ? "bg-muted-foreground/20 text-muted-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  {category}
                  <span className="ml-1 opacity-70">
                    ({categoryCount})
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border bg-background">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold">Integrations</h2>
              <p className="text-xs text-muted-foreground">
                Select from your connected credential profiles to add tools
              </p>
            </div>
          </div>
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search apps... (e.g., Gmail, Slack, Notion)"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
            {search && (
              <Button 
                type="submit" 
                size="sm" 
                variant="ghost" 
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 px-2"
              >
                Search
              </Button>
            )}
          </form>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading apps...</span>
              </div>
            </div>
          )}

          {!isLoading && appsData?.apps && appsData.apps.length > 0 && (
            <>
              <div className={cn(
                "gap-3",
                viewMode === 'grid' 
                  ? "grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3" 
                  : "space-y-2"
              )}>
                {appsData.apps.map((app: PipedreamApp) => (
                  <AppCard key={app.id} app={app} />
                ))}
              </div>

              {appsData.page_info && appsData.page_info.has_more && (
                <div className="flex justify-center pt-4">
                  <Button
                    onClick={() => setPage(page + 1)}
                    disabled={isLoading}
                    variant="outline"
                    size="sm"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin mr-2" />
                        Loading...
                      </>
                    ) : (
                      'Load More Apps'
                    )}
                  </Button>
                </div>
              )}
            </>
          )}

          {!isLoading && appsData?.apps && appsData.apps.length === 0 && (
            <div className="text-center py-8">
              <div className="text-3xl mb-3">🔍</div>
              <h3 className="text-base font-medium mb-2">No apps found</h3>
              <p className="text-sm text-muted-foreground mb-3">
                {selectedCategory 
                  ? `No apps found in "${selectedCategory}" category` 
                  : "Try adjusting your search criteria"
                }
              </p>
              <Button
                onClick={() => {
                  setSearch('');
                  setSelectedCategory('');
                  setPage(1);
                }}
                variant="outline"
                size="sm"
              >
                Clear Filters
              </Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={showToolSelector} onOpenChange={setShowToolSelector}>
        <DialogContent className='max-w-3xl'>
          <DialogHeader>
            <DialogTitle>Select Tools for {selectedProfile?.app_name}</DialogTitle>
          </DialogHeader>
          <PipedreamToolSelector
            appSlug={selectedProfile?.app_slug || ''}
            profile={selectedProfile}
            onToolsSelected={handleToolsSelected}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showProfileManager} onOpenChange={handleProfileManagerClose}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Create {selectedAppForProfile?.app_name} Profile
            </DialogTitle>
            <DialogDescription>
              Create a credential profile for {selectedAppForProfile?.app_name} to connect and use its tools
            </DialogDescription>
          </DialogHeader>
          <CredentialProfileManager
            appSlug={selectedAppForProfile?.app_slug}
            appName={selectedAppForProfile?.app_name}
            onProfileSelect={() => {
              queryClient.invalidateQueries({ queryKey: pipedreamKeys.profiles.all() });
              handleProfileManagerClose();
              toast.success(`Profile created for ${selectedAppForProfile?.app_name}!`);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}; 