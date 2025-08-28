import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Loader2, ExternalLink, Zap, User, CheckCircle2, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { usePipedreamApps } from '@/hooks/react-query/pipedream/use-pipedream';
import { usePipedreamProfiles } from '@/hooks/react-query/pipedream/use-pipedream-profiles';
import { CredentialProfileSelector } from './credential-profile-selector';
import { PipedreamToolSelector } from './pipedream-tool-selector';
import { CredentialProfileManager } from './credential-profile-manager';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { PipedreamProfile } from '@/types/pipedream-profiles';
import type { PipedreamApp } from '@/hooks/react-query/pipedream/utils';
import { useQueryClient } from '@tanstack/react-query';
import { pipedreamKeys } from '@/hooks/react-query/pipedream/keys';

interface PipedreamRegistryProps {
  onProfileSelected?: (profile: PipedreamProfile) => void;
  onToolsSelected?: (profileId: string, selectedTools: string[], appName: string, appSlug: string) => void;
}

export const PipedreamRegistry: React.FC<PipedreamRegistryProps> = ({
  onProfileSelected,
  onToolsSelected
}) => {
  const [search, setSearch] = useState('');
  const [selectedCategory] = useState<string>(''); // Category filtering removed - always show all apps
  const [page, setPage] = useState(1);
  // Removed viewMode - using consistent grid layout
  const [showToolSelector, setShowToolSelector] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<PipedreamProfile | null>(null);
  const [showProfileManager, setShowProfileManager] = useState(false);
  const [selectedAppForProfile, setSelectedAppForProfile] = useState<{ app_slug: string; app_name: string } | null>(null);

  const queryClient = useQueryClient();
  const { data: appsData, isLoading, error, refetch } = usePipedreamApps(page, search, selectedCategory);
  const { data: profiles } = usePipedreamProfiles();
  
  // Removed allAppsData query - no longer needed without category filtering

  // Categories removed - always show all apps without filtering

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    refetch();
  };

  // Category selection removed - always show all apps

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
    // According to Pipedream API docs, all apps should have img_src
    // But we'll be defensive in case some don't
    if (app.img_src && app.img_src.trim()) {
      return app.img_src;
    }
    
    // Fallback to Clearbit logo service if img_src is missing
    const logoSlug = app.name_slug.toLowerCase();
    return `https://logo.clearbit.com/${logoSlug}.com`;
  };

  const getAppProfiles = (appSlug: string) => {
    return profiles?.filter(p => p.app_slug === appSlug && p.is_active) || [];
  };

  const AppIcon: React.FC<{ app: PipedreamApp }> = ({ app }) => {
    const [imageError, setImageError] = useState(false);
    const [fallbackError, setFallbackError] = useState(false);

    const handleImageError = () => {
      setImageError(true);
    };

    const handleFallbackError = () => {
      setFallbackError(true);
    };

    // If both official and fallback images failed, show letter
    if (imageError && fallbackError) {
      return (
        <div className='h-12 w-12 rounded-lg flex items-center justify-center bg-primary/20 border border-border/50'>
          <span className="text-primary font-semibold text-lg">
            {app.name.charAt(0).toUpperCase()}
          </span>
        </div>
      );
    }

    // If official image failed, try Clearbit fallback
    if (imageError) {
      const logoSlug = app.name_slug.toLowerCase();
      const clearbitUrl = `https://logo.clearbit.com/${logoSlug}.com`;
      
      return (
        <div className='h-12 w-12 rounded-lg flex items-center justify-center overflow-hidden bg-background shadow-sm border border-border/50'>
          <img
            src={clearbitUrl}
            alt={`${app.name} logo`}
            className="w-8 h-8 object-contain"
            onError={handleFallbackError}
          />
        </div>
      );
    }

    // Try official image first
    return (
      <div className='h-12 w-12 rounded-lg flex items-center justify-center overflow-hidden bg-background shadow-sm border border-border/50'>
        <img
          src={getAppLogoUrl(app)}
          alt={`${app.name} logo`}
          className="w-8 h-8 object-contain"
          onError={handleImageError}
        />
      </div>
    );
  };

  const AppCard: React.FC<{ app: PipedreamApp }> = ({ app }) => {
    const appProfiles = getAppProfiles(app.name_slug);
    const connectedProfiles = appProfiles.filter(p => p.is_connected);
    const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

    return (
      <Card className="group transition-all duration-200 hover:shadow-lg border border-border hover:border-primary/20 bg-card hover:bg-card/95 h-full">
        <CardContent className="p-5 h-full">
          <div className="flex flex-col h-full">
            {/* App Icon and Name */}
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0">
                <AppIcon app={app} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base text-foreground truncate leading-tight">{app.name}</h3>
                {app.categories.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {app.categories[0]}
                  </p>
                )}
              </div>
            </div>

            {/* Description */}
            <p className="text-sm text-muted-foreground line-clamp-2 mb-4 flex-1 leading-relaxed">
              {app.description}
            </p>

            {/* Featured Badge */}
            {app.featured_weight > 100000 && (
              <div className="mb-4">
                <Badge variant="default" className="text-xs bg-primary/10 text-primary border-primary/20">
                  Featured
                </Badge>
              </div>
            )}

            {/* Connection Status */}
            <div className="mt-auto">
              {connectedProfiles.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="text-sm text-green-600 font-medium">Connected</span>
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
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                    <span className="text-sm text-muted-foreground">Not connected</span>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => handleCreateProfile(app)}
                    className="w-full h-9 text-sm font-medium"
                  >
                    <Plus className="h-4 w-4 mr-2" />
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
    <div className="h-full max-h-[80vh]">
      <div className="flex flex-col h-full max-h-[calc(100vh-200px)]">
        <div className="p-6 border-b border-border bg-card">
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-2">Browse Apps</h2>
            <p className="text-sm text-muted-foreground">
              Connect your favorite apps with your agent
            </p>
          </div>
          
          <form onSubmit={handleSearchSubmit} className="max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search apps..."
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
                <span className="text-sm">Loading apps...</span>
              </div>
            </div>
          )}

          {!isLoading && appsData?.apps && appsData.apps.length > 0 && (
            <>
              {/* Featured Apps Section - only show on first page with no search */}
              {page === 1 && !search && (
                <>
                  <div className="mb-8">
                    <div className="flex items-center gap-2 mb-4">
                      <h3 className="text-lg font-semibold text-foreground">Featured Apps</h3>
                      <Badge variant="outline" className="text-xs">Popular</Badge>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 max-w-full">
                      {appsData.apps.filter(app => app.featured_weight > 100000).slice(0, 8).map((app: PipedreamApp) => (
                        <AppCard key={`featured-${app.id}`} app={app} />
                      ))}
                    </div>
                  </div>
                  
                  {/* All Apps Section */}
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-foreground mb-4">All Apps</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 max-w-full">
                      {appsData.apps.map((app: PipedreamApp) => (
                        <AppCard key={app.id} app={app} />
                      ))}
                    </div>
                  </div>
                </>
              )}
              
              {/* Regular view for search results or subsequent pages */}
              {(page > 1 || search) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 max-w-full">
                  {appsData.apps.map((app: PipedreamApp) => (
                    <AppCard key={app.id} app={app} />
                  ))}
                </div>
              )}

              {appsData.page_info && appsData.page_info.end_cursor && (
                <div className="flex justify-center pt-8">
                  <Button
                    onClick={() => setPage(page + 1)}
                    disabled={isLoading}
                    variant="default"
                    size="lg"
                    className="px-8 py-2 bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Loading more apps...
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
            <div className="text-center py-12 bg-card border border-border rounded-lg mx-4">
              <div className="max-w-md mx-auto">
                <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No apps found</h3>
                <p className="text-muted-foreground mb-6">
                  No apps match your search criteria. Try adjusting your search terms.
                </p>
                <Button
                  onClick={() => {
                    setSearch('');
                    setPage(1);
                  }}
                  variant="default"
                  className="px-6"
                >
                  <Search className="h-4 w-4 mr-2" />
                  View All Apps
                </Button>
              </div>
            </div>
          )}

          {!isLoading && error && (
            <div className="text-center py-12 bg-card border border-destructive/20 rounded-lg mx-4">
              <div className="max-w-md mx-auto">
                <div className="h-12 w-12 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-destructive text-xl">⚠</span>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-destructive">Failed to load apps</h3>
                <p className="text-muted-foreground mb-6">
                  There was an error loading the apps. Please try again.
                </p>
                <Button variant="default" onClick={() => refetch()} className="px-6">
                  Try Again
                </Button>
              </div>
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