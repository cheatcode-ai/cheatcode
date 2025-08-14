'use client';

import { Button } from "@/components/ui/button"
import { PanelRightOpen, Check, X, Menu, TrendingUp, Globe, User, Settings, LogOut, Zap, Loader2 } from "lucide-react"
import NextLink from 'next/link'
import { usePathname } from "next/navigation"
import { toast } from "sonner"
import { CheatcodeLogo } from "@/components/sidebar/cheatcode-logo"
import { useUser, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClerkBackendApi } from '@/lib/api-client';
import { useAuth } from '@clerk/nextjs';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Link from 'next/link';
import { Barcode, ExternalLink, Info, RefreshCw, Rocket } from 'lucide-react';
import { useBilling } from '@/contexts/BillingContext';
import { useModal } from '@/hooks/use-modal-store';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { useState, useRef, KeyboardEvent, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { useUpdateProject } from "@/hooks/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/ui/sidebar"
import { projectKeys } from "@/hooks/react-query/sidebar/keys";
import { threadKeys } from "@/hooks/react-query/threads/keys";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Import our focused contexts
import { useThreadState } from "@/app/(home)/projects/[projectId]/thread/_contexts/ThreadStateContext";
import { useLayout } from "@/app/(home)/projects/[projectId]/thread/_contexts/LayoutContext";

interface MCPCredentialProfile {
  profile_id: string;
  mcp_qualified_name: string;
  display_name: string;
  is_default_for_dashboard: boolean;
  is_active: boolean;
}

export function SiteHeader() {
  // Get data from contexts instead of props
  const { threadId, projectId, projectName, project } = useThreadState();
  const { toggleSidePanel, isMobile, debugMode, isSidePanelOpen, handleProjectRenamed } = useLayout();
  
  const pathname = usePathname();
  const { setOpen: setLeftSidebarOpen, state: leftSidebarState } = useSidebar();
  const { user } = useUser();
  const router = useRouter();
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(projectName);
  const inputRef = useRef<HTMLInputElement>(null);

  const { setOpenMobile } = useSidebar()
  const updateProjectMutation = useUpdateProject()
  const [isUpdatingIntegration, setIsUpdatingIntegration] = useState<string | null>(null);

  // Deploy UI state
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);
  const [deployPopoverOpen, setDeployPopoverOpen] = useState(false);
  const [domainsInput, setDomainsInput] = useState<string>("");
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [isUpdatingDeployment, setIsUpdatingDeployment] = useState<boolean>(false);
  const [deployProgress, setDeployProgress] = useState(0);
  const { onOpen } = useModal();

  // Progress bar simulation effect for perceived progress
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isDeploying || isUpdatingDeployment) {
      setDeployProgress(0);
      interval = setInterval(() => {
        setDeployProgress(prev => {
          // Simulate realistic deployment progress: fast start, slow middle, fast finish
          if (prev < 30) return prev + Math.random() * 8 + 2; // 2-10% increments
          if (prev < 70) return prev + Math.random() * 3 + 0.5; // 0.5-3.5% increments  
          if (prev < 95) return prev + Math.random() * 2 + 0.2; // 0.2-2.2% increments
          return prev; // Stay at ~95% until deployment completes
        });
      }, 800);
    } else {
      setDeployProgress(0);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isDeploying, isUpdatingDeployment]);

  // Complete progress when deployment finishes
  useEffect(() => {
    if (!isDeploying && !isUpdatingDeployment && deployProgress > 0) {
      setDeployProgress(100);
      const timeout = setTimeout(() => setDeployProgress(0), 500);
      return () => clearTimeout(timeout);
    }
  }, [isDeploying, isUpdatingDeployment, deployProgress]);

  // Fetch deployment status
  const { data: deploymentStatus, isLoading: isLoadingDeploymentStatus } = useQuery({
    queryKey: ['deployment-status', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const apiClient = createClerkBackendApi(getToken);
      const response = await apiClient.get(`/project/${projectId}/deployment/status`);
      return response.success ? response.data : null;
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes (deployment status changes infrequently)
    gcTime: 10 * 60 * 1000, // 10 minutes garbage collection time (replaces cacheTime)
  });

  // Fetch MCP credential profiles
  const { data: mcpProfiles = [], isLoading: isMcpLoading } = useQuery({
    queryKey: ['mcp-credential-profiles'],
    queryFn: async () => {
      const apiClient = createClerkBackendApi(getToken);
      const response = await apiClient.get('/pipedream/profiles');
      return response.data || [];
    },
    enabled: true,
  });

  // Update integration toggle mutation
  const updateIntegrationMutation = useMutation({
    mutationFn: async ({ profileId, isDefault }: { profileId: string; isDefault: boolean }) => {
      const apiClient = createClerkBackendApi(getToken);
      await apiClient.put(`/pipedream/profiles/${profileId}`, {
        is_default_for_dashboard: isDefault
      });
      return { profileId, isDefault };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['mcp-credential-profiles'], (old: MCPCredentialProfile[]) => {
        return old?.map(profile => 
          profile.profile_id === data.profileId 
            ? { ...profile, is_default_for_dashboard: data.isDefault }
            : profile
        ) || [];
      });
      const action = data.isDefault ? 'enabled' : 'disabled';
      toast.success(`${action.charAt(0).toUpperCase() + action.slice(1)} integration for chats`);
    },
    onError: (error) => {
      console.error('Error updating integration:', error);
      toast.error('Failed to update integration setting');
    },
    onSettled: () => {
      setIsUpdatingIntegration(null);
    }
  });

  const handleIntegrationToggle = async (profileId: string, currentValue: boolean) => {
    setIsUpdatingIntegration(profileId);
    await updateIntegrationMutation.mutateAsync({ 
      profileId, 
      isDefault: !currentValue 
    });
  };

  const handleSignOut = async () => {
    await signOut({ redirectUrl: '/' });
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const startEditing = () => {
    setTempName(projectName);
    setIsEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setTempName(projectName);
  };

  const saveNewName = async () => {
    if (tempName.trim() === '') {
      setTempName(projectName);
      setIsEditing(false);
      return;
    }

    if (tempName !== projectName) {
      try {
        if (!projectId) {
          toast.error('Cannot rename: Project ID is missing');
          setTempName(projectName);
          setIsEditing(false);
          return;
        }

        const updatedProject = await updateProjectMutation.mutateAsync({
          projectId,
          data: { name: tempName }
        })
        if (updatedProject) {
          handleProjectRenamed?.(tempName);
          queryClient.invalidateQueries({ queryKey: threadKeys.project(projectId) });
        } else {
          throw new Error('Failed to update project');
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to rename project';
        console.error('Failed to rename project:', errorMessage);
        toast.error(errorMessage);
        setTempName(projectName);
      }
    }

    setIsEditing(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      saveNewName();
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  };

  return (
    <>
      <header className={cn(
        "bg-background border-0 shadow-none fixed top-0 left-0 right-0 flex h-14 shrink-0 items-center justify-between z-30 w-full",
        isMobile ? "px-2" : "px-4"
      )}>
        {/* Left side - Logo/hamburger and project name */}
        <div className="flex items-center gap-2">
          {/* Logo button to open sidebar when closed */}
          {leftSidebarState === 'collapsed' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLeftSidebarOpen(true)}
              className="h-9 w-9 ml-2"
              aria-label="Open sidebar"
              title="Open sidebar"
            >
              <CheatcodeLogo size={22} />
            </Button>
          )}

          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpenMobile(true)}
              className="h-9 w-9 mr-1"
              aria-label="Open sidebar"
            >
              <Menu className="h-4 w-4" />
            </Button>
          )}

          <div className="flex items-center gap-2 px-3">
            {isEditing ? (
              <div className="flex items-center gap-1">
                <Input
                  ref={inputRef}
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={saveNewName}
                  className="h-8 w-auto min-w-[180px] text-base font-medium"
                  maxLength={50}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={saveNewName}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={cancelEditing}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : !projectName || projectName === 'Project' ? (
              <Skeleton className="h-5 w-32" />
            ) : (
              <div
                className="text-sm font-bold text-muted-foreground hover:text-foreground cursor-pointer flex items-center"
                onClick={startEditing}
                title="Click to rename project"
              >
                {projectName}
              </div>
            )}
          </div>
        </div>

        {/* Right side - Action buttons pushed to extreme right */}
        <div className="flex items-center gap-4">
          {/* Debug mode indicator */}
          {debugMode && (
            <div className="bg-amber-500 text-black text-xs px-2 py-0.5 rounded-md mr-2">
              Debug
            </div>
          )}

          {/* Action buttons on the extreme right */}
          {!isMobile && (
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 px-3 text-xs bg-muted hover:bg-muted/80"
                onClick={() => onOpen('paymentRequiredDialog')}
              >
                <TrendingUp className="w-3 h-3 mr-1.5 text-pink-400" />
                Upgrade Plan
              </Button>
              {/* Hide deploy controls entirely for mobile app type */}
              {projectId && project?.app_type === 'mobile' ? null : isLoadingDeploymentStatus ? (
                <Skeleton className="h-8 w-[140px]" />
              ) : (
                (deploymentStatus as any)?.has_deployment ? (
                  <Popover open={deployPopoverOpen} onOpenChange={setDeployPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 px-3 text-xs bg-muted hover:bg-muted/80"
                      >
                        <Globe className="w-3 h-3 mr-1.5 text-blue-400" />
                        Manage Deployment
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 rounded-2xl ring-1 ring-white/10 bg-gray-950/95 backdrop-blur-md shadow-xl border-0 p-0">
                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                            <Globe className="w-4 h-4 text-gray-200" />
                            Manage your deployment
                          </h4>
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full">
                            <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-pulse ${(isDeploying || isUpdatingDeployment) ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${(isDeploying || isUpdatingDeployment) ? 'bg-amber-400 shadow-[0_0_8px_2px_rgba(251,191,36,0.7)]' : 'bg-emerald-400 shadow-[0_0_8px_2px_rgba(16,185,129,0.7)]'}`} />
                          </span>
                        </div>
                        
                        {/* Progress bar during deployment/redeployment */}
                        {(isDeploying || isUpdatingDeployment) && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-300">
                                {isUpdatingDeployment ? 'Redeploying...' : 'Deploying...'}
                              </span>
                              <span className="text-gray-400">{Math.round(deployProgress)}%</span>
                            </div>
                            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-amber-400 to-amber-300 rounded-full transition-all duration-300 ease-out"
                                style={{ width: `${deployProgress}%` }}
                              />
                            </div>
                          </div>
                        )}
                        
                        {/* Deployed site link */}
                        {(deploymentStatus as any)?.domains && (deploymentStatus as any).domains.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">Your site is live at:</p>
                            {(deploymentStatus as any).domains.map((domain: string, index: number) => (
                              <a
                                key={index}
                                href={`https://${domain}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 ring-1 ring-white/10 hover:bg-white/10 hover:ring-white/20 transition-colors group"
                              >
                                <Globe className="w-4 h-4 text-gray-200" />
                                <span className="text-sm text-gray-200 group-hover:text-white truncate">{domain}</span>
                                <ExternalLink className="w-3.5 h-3.5 text-gray-200 ml-auto" />
                              </a>
                            ))}
                          </div>
                        )}

                        {/* Action buttons side by side */}
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="flex-1 h-9 text-xs bg-gradient-to-br from-white/10 to-white/5 hover:from-white/15 hover:to-white/10 text-white ring-1 ring-white/10"
                        onClick={async () => {
                          if (!projectId) {
                            toast.error('Missing project ID');
                            return;
                          }
                          try {
                            setIsUpdatingDeployment(true);
                                // temporarily show amber status while redeploying
                                // UI effect handled by disabling button state below
                            const apiClient = createClerkBackendApi(getToken);
                                await apiClient.post(`/project/${projectId}/deploy/git/update`, {}, {
                                  timeout: 600000, // 10 minutes for deploy update requests
                                });
                            toast.success('Deployment update triggered');
                                setDeployPopoverOpen(false);
                            // Invalidate deployment status cache to refresh UI
                            queryClient.invalidateQueries({ queryKey: ['deployment-status', projectId] });
                          } catch (e) {
                            console.error(e);
                            toast.error('Failed to trigger deployment update');
                          } finally {
                            setIsUpdatingDeployment(false);
                          }
                        }}
                        disabled={isUpdatingDeployment}
                      >
                            {isUpdatingDeployment ? (
                              <Loader2 className="w-3 h-3 mr-1.5 animate-spin text-amber-300" />
                            ) : (
                              <Rocket className="w-3 h-3 mr-1.5 text-gray-200" />
                            )}
                            Redeploy
                          </Button>
                          
                          <Button
                            variant="secondary"
                            size="sm"
                            className="flex-1 h-9 text-xs bg-gradient-to-br from-white/10 to-white/5 hover:from-white/15 hover:to-white/10 text-white ring-1 ring-white/10"
                        onClick={() => {
                          // Pre-populate form with existing deployment data
                          if (deploymentStatus) {
                            const status = deploymentStatus as any;
                            setDomainsInput(status.domains?.join(', ') || '');
                          }
                          setDeployDialogOpen(true);
                              setDeployPopoverOpen(false);
                        }}
                      >
                            <Settings className="w-3 h-3 mr-1.5 text-gray-200" />
                            Domains
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Popover open={deployPopoverOpen} onOpenChange={setDeployPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 px-3 text-xs bg-muted hover:bg-muted/80"
                      >
                        <Globe className="w-3 h-3 mr-1.5 text-blue-400" />
                        Deploy
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 rounded-2xl ring-1 ring-white/10 bg-gray-950/95 backdrop-blur-md shadow-xl border-0 p-0">
                      <div className="p-4 space-y-3">
                        <h4 className="text-sm font-semibold text-white">Deploy your site</h4>
                        <p className="text-sm text-muted-foreground">
                            Your app will be deployed to a .style.dev domain based on your project name.
                          </p>
                        
                        {/* Progress bar during deployment */}
                        {isDeploying && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-300">Deploying...</span>
                              <span className="text-gray-400">{Math.round(deployProgress)}%</span>
                            </div>
                            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-blue-400 to-blue-300 rounded-full transition-all duration-300 ease-out"
                                style={{ width: `${deployProgress}%` }}
                              />
                            </div>
                          </div>
                        )}
                        <Button
                          className="w-full h-9 bg-white text-black hover:bg-white/90"
                          onClick={async () => {
                            if (!projectId) {
                              toast.error('Missing project ID');
                              return;
                            }
                            try {
                              setIsDeploying(true);
                              const apiClient = createClerkBackendApi(getToken);
                              const res = await apiClient.post(`/project/${projectId}/deploy/git`, {
                                domains: [], // Empty array triggers default domain generation
                              }, {
                                timeout: 600000, // 10 minutes for deploy requests
                              });
                              if (res.success) {
                                const data: any = res.data;
                                const list = (data?.domains || []).filter(Boolean);
                                toast.success(`Deployed${list.length ? ` @ ${list.join(', ')}` : ''}`);
                                setDeployPopoverOpen(false);
                                // Invalidate deployment status to refresh the button state
                                queryClient.invalidateQueries({ queryKey: ['deployment-status', projectId] });
                              } else {
                                toast.error('Deployment failed');
                              }
                            } catch (e) {
                              console.error(e);
                              toast.error('Deployment failed');
                            } finally {
                              setIsDeploying(false);
                            }
                          }}
                          disabled={isDeploying}
                        >
                          {isDeploying ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin text-blue-500" />
                          ) : (
                            <Globe className="w-4 h-4 mr-2 text-blue-500" />
                          )}
                          {isDeploying ? 'Deploying...' : 'Deploy Site'}
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                )
              )}
              
              {/* Integrations Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 px-3 text-xs bg-muted hover:bg-muted/80"
                  >
                    <Zap className="w-3 h-3 mr-1.5 text-green-400" />
                    Integrations
                    {mcpProfiles.filter(p => p.is_default_for_dashboard).length > 0 && (
                      <Badge variant="secondary" className="ml-2 h-4 px-1.5 text-xs">
                        {mcpProfiles.filter(p => p.is_default_for_dashboard).length}
                      </Badge>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-80 rounded-2xl ring-1 ring-white/10 bg-gray-950/95 backdrop-blur-md shadow-xl border-0 p-0"
                  align="end"
                  sideOffset={8}
                >
                  <div className="p-4 space-y-3">
                    <h4 className="text-sm font-semibold text-white">Integrations</h4>
                    <p className="text-sm text-muted-foreground">
                      Connect and enable tools for your dashboard chats. Manage all integrations in settings.
                    </p>

                    <Button asChild className="w-full h-9 bg-white text-black hover:bg-white/90">
                      <a href="/settings/integrations" className="flex items-center justify-center gap-2">
                        <Zap className="h-4 w-4 text-green-500" />
                        Manage Integrations
                      </a>
                        </Button>
                      </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* User Profile */}
          {user && !isMobile && (
            <div className="mr-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                  >
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={user.imageUrl} alt={user.fullName || 'User'} />
                      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-xs font-semibold">
                        {getInitials(user.fullName || user.firstName || user.emailAddresses[0]?.emailAddress?.split('@')[0] || 'U')}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-64 rounded-2xl ring-1 ring-white/10 bg-gray-900/95 backdrop-blur-md shadow-xl border-0"
                  align="end"
                  sideOffset={8}
                >
                  {/* Plan Header */}
                  <PopoverPlanHeader />

                  {/* Account Stats */}
                  <PopoverStats deploymentStatus={deploymentStatus as any} isLoadingDeploymentStatus={isLoadingDeploymentStatus} />

                  {/* Logout */}
                  <div className="border-t border-gray-800 px-1 py-0.5">
                    <DropdownMenuItem asChild className="cursor-pointer">
                      <button
                        onClick={handleSignOut}
                        className="flex items-center gap-2 w-full px-2 py-1 text-left text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
                      >
                        <LogOut className="h-4 w-4" />
                        <span>Sign out</span>
                      </button>
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {isMobile ? (
            // Mobile view - only show the side panel toggle
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidePanel}
              className="h-9 w-9 cursor-pointer"
              aria-label="Toggle computer panel"
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          ) : (
            // Desktop view - show all buttons with tooltips
            <div className="flex gap-2 ml-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidePanel}
                className="h-9 w-9 cursor-pointer"
                title="Toggle Computer Preview (CMD+I)"
              >
                <PanelRightOpen className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </header>
      
      {/* Custom Domain Dialog */}
      <Dialog open={deployDialogOpen} onOpenChange={setDeployDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Custom Domains</DialogTitle>
            <div className="text-sm text-muted-foreground">
              Add custom domains to your deployed site. Your .style.dev domain will remain active.
            </div>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Progress bar during deployment */}
            {isDeploying && (
              <div className="space-y-1.5 p-3 bg-muted/20 rounded-lg">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground">Deploying with custom domains...</span>
                  <span className="text-muted-foreground">{Math.round(deployProgress)}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${deployProgress}%` }}
                  />
                </div>
              </div>
            )}
            
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Additional Domains (comma-separated)</label>
              <Input
                value={domainsInput}
                onChange={(e) => setDomainsInput(e.target.value)}
                placeholder="www.yourdomain.com, app.mydomain.io"
                disabled={isDeploying}
              />
              <div className="text-xs text-muted-foreground mt-1">
                These domains will be added to your existing deployment
              </div>
            </div>

            <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded">
              <strong>DNS Setup Required:</strong> For each custom domain, set an A record pointing to <code className="bg-background px-1 rounded">35.235.84.134</code>. DNS may take time to propagate.
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setDeployDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!projectId) {
                    toast.error('Missing project ID');
                    return;
                  }
                  // Parse custom domains
                  const customDomains = domainsInput
                    .split(',')
                    .map((d) => d.trim())
                    .filter(Boolean);
                  
                  if (customDomains.length === 0) {
                    toast.error('Please enter at least one domain');
                    return;
                  }
                  
                  try {
                    setIsDeploying(true);
                    const apiClient = createClerkBackendApi(getToken);
                    const res = await apiClient.post(`/project/${projectId}/deploy/git`, {
                      domains: customDomains,
                    }, {
                      timeout: 600000, // 10 minutes for deploy requests
                    });
                    if (res.success) {
                      const data: any = res.data;
                      const list = (data?.domains || customDomains).filter(Boolean);
                      toast.success(`Custom domains added: ${list.join(', ')}`);
                      setDeployDialogOpen(false);
                      setDomainsInput(''); // Clear input
                      // Invalidate deployment status to refresh the button state
                      queryClient.invalidateQueries({ queryKey: ['deployment-status', projectId] });
                    } else {
                      toast.error('Failed to add custom domains');
                    }
                  } catch (e) {
                    console.error(e);
                    toast.error('Failed to add custom domains');
                  } finally {
                    setIsDeploying(false);
                  }
                }}
                disabled={isDeploying}
              >
                {isDeploying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {isDeploying ? 'Adding...' : 'Add Domains'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </>
  )
} 

// Shared popover header/stats copied from homepage navbar and trimmed for thread view
function PopoverPlanHeader() {
  const { planName } = useBilling() as any;
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800/80 bg-gradient-to-b from-white/5 to-transparent rounded-t-2xl">
      <div className="flex items-center gap-1.5">
        <Barcode className="h-4 w-4 text-green-500" />
        <span className="text-sm font-medium text-white">
          {planName || 'Free'}
        </span>
      </div>
      <Link 
        href="/settings/billing" 
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
      >
        Manage
        <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}

function PopoverStats({ deploymentStatus, isLoadingDeploymentStatus }: { deploymentStatus: any; isLoadingDeploymentStatus: boolean }) {
  const { 
    creditsRemaining,
    billingLoading,
    rawCreditsTotal,
    rawCreditsRemaining,
    planName,
    deploymentsUsed,
    deploymentsTotal,
    deploymentUsagePercentage
  } = useBilling() as any;

  // Use actual plan data instead of hardcoded
  const isFreeUser = planName?.toLowerCase() === 'free' || !planName;
  const maxRefills = 4;
  const creditsPerRefill = 5;
  const creditsUsed = (rawCreditsTotal || 20) - (rawCreditsRemaining || 20);
  const refillsUsed = Math.min(Math.ceil(creditsUsed / creditsPerRefill), maxRefills);
  const refillsProgressPercentage = (refillsUsed / maxRefills) * 100;

  return (
    <TooltipProvider>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-300">Credits</span>
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 ring-1 ring-white/15 bg-transparent">
            <span className="text-sm font-semibold text-gray-100 tabular-nums">
              {!billingLoading && creditsRemaining !== undefined ? creditsRemaining.toFixed(0) : '--'}
            </span>
            <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_0_2px_rgba(34,197,94,0.35)]"></div>
          </div>
        </div>

        {/* Daily Refills - Only for Free users */}
        {isFreeUser && !billingLoading && rawCreditsTotal !== undefined && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-gray-300">Daily refills</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-gray-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">You get up to 4 refills each month. Each refill is 5 credits for the day.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <span className="text-sm font-medium text-white">{refillsUsed}/{maxRefills}</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-[3px]">
              <div
                className="bg-green-500 h-[3px] rounded-full transition-all duration-300 shadow-[0_0_6px_1px_rgba(34,197,94,0.35)]"
                style={{ width: `${refillsProgressPercentage}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Deployments - Use actual billing context data */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Deployments</span>
            <span className="text-sm font-medium text-white">
              {billingLoading ? '--' : `${deploymentsUsed || 0}/${deploymentsTotal || 0}`}
            </span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-[3px]">
            <div 
              className="bg-green-500 h-[3px] rounded-full transition-all duration-300 shadow-[0_0_6px_1px_rgba(34,197,94,0.35)]" 
              style={{ width: `${deploymentUsagePercentage || 0}%` }}
            ></div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
} 