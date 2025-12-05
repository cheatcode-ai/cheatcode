'use client';

import { Button } from "@/components/ui/button"
import { PanelRightOpen, Check, X, Menu, TrendingUp, Globe, Loader2 } from "lucide-react"
import { usePathname } from "next/navigation"
import { toast } from "sonner"
import { CheatcodeLogo } from "@/components/sidebar/cheatcode-logo"
import { useUser } from '@clerk/nextjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClerkBackendApi } from '@/lib/api-client';
import { useAuth } from '@clerk/nextjs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ExternalLink, Rocket } from 'lucide-react';
import { useModal } from '@/hooks/use-modal-store';

import { useState, useRef, KeyboardEvent, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { useUpdateProject } from "@/hooks/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/ui/sidebar"
import { threadKeys } from "@/hooks/react-query/threads/keys";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Import our focused contexts
import { useThreadState } from "@/app/(home)/projects/[projectId]/thread/_contexts/ThreadStateContext";
import { useLayout } from "@/app/(home)/projects/[projectId]/thread/_contexts/LayoutContext";

// Consolidated components and utilities
import { IntegrationsDropdown } from '@/components/integrations/integrations-dropdown';
import { ProfilePlanHeader, ProfileStats, ProfileLogoutButton } from '@/components/user/profile-popover';
import { getUserInitials } from '@/lib/utils/user';

export function SiteHeader() {
  // Get data from contexts instead of props
  const { threadId, projectId, projectName, project } = useThreadState();
  const { toggleSidePanel, isMobile, debugMode, isSidePanelOpen, handleProjectRenamed } = useLayout();

  const pathname = usePathname();
  const { setOpen: setLeftSidebarOpen, state: leftSidebarState } = useSidebar();
  const { user } = useUser();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(projectName);
  const inputRef = useRef<HTMLInputElement>(null);

  const { setOpenMobile } = useSidebar()
  const updateProjectMutation = useUpdateProject()

  // Deploy UI state
  const [deployPopoverOpen, setDeployPopoverOpen] = useState(false);
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

  // Fetch deployment status (static info)
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

  // Fetch live deployment status (poll during deployment)
  const { data: liveStatus } = useQuery({
    queryKey: ['deployment-live-status', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const apiClient = createClerkBackendApi(getToken);
      const response = await apiClient.get(`/project/${projectId}/deployment/live-status`);
      return response.success ? response.data : null;
    },
    enabled: !!projectId && (isDeploying || isUpdatingDeployment),
    refetchInterval: (isDeploying || isUpdatingDeployment) ? 2000 : false, // Poll every 2s during deployment
    staleTime: 0, // Always fresh
  });

  // Map live status to progress percentage
  useEffect(() => {
    if (liveStatus?.state && (isDeploying || isUpdatingDeployment)) {
      const stateToProgress: Record<string, number> = {
        'preparing': 10,
        'pushing': 25,
        'building': 50,
        'deploying': 80,
        'deployed': 100,
        'failed': 100,
      };
      const targetProgress = stateToProgress[liveStatus.state];
      if (targetProgress !== undefined && targetProgress > deployProgress) {
        setDeployProgress(targetProgress);
      }

      // Auto-complete when deployed
      if (liveStatus.state === 'deployed') {
        setIsDeploying(false);
        setIsUpdatingDeployment(false);
        queryClient.invalidateQueries({ queryKey: ['deployment-status', projectId] });
        toast.success('Deployment complete!');
      } else if (liveStatus.state === 'failed') {
        setIsDeploying(false);
        setIsUpdatingDeployment(false);
        toast.error(liveStatus.message || 'Deployment failed');
      }
    }
  }, [liveStatus?.state, liveStatus?.message, isDeploying, isUpdatingDeployment, deployProgress, projectId, queryClient]);


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
                                {liveStatus?.state === 'preparing' ? 'Preparing...' :
                                 liveStatus?.state === 'pushing' ? 'Pushing code...' :
                                 liveStatus?.state === 'building' ? 'Building...' :
                                 liveStatus?.state === 'deploying' ? 'Deploying...' :
                                 isUpdatingDeployment ? 'Redeploying...' : 'Preparing...'}
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
                              <span className="text-gray-300">
                                {liveStatus?.state === 'preparing' ? 'Preparing...' :
                                 liveStatus?.state === 'pushing' ? 'Pushing code...' :
                                 liveStatus?.state === 'building' ? 'Building...' :
                                 liveStatus?.state === 'deploying' ? 'Deploying...' : 'Preparing...'}
                              </span>
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
              <IntegrationsDropdown triggerVariant="button" />
            </div>
          )}

          {/* User Profile */}
          {user && !isMobile && (
            <div className="mr-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-8 w-8 rounded-full hover:opacity-80 transition-opacity">
                    <Avatar className="h-8 w-8 border border-white/[0.12]">
                      <AvatarImage src={user.imageUrl} alt={user.fullName || 'User'} />
                      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-xs font-semibold">
                        {getUserInitials(user.fullName || user.firstName || user.emailAddresses[0]?.emailAddress?.split('@')[0] || 'U')}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-64 rounded-2xl ring-1 ring-white/10 bg-gray-900/95 backdrop-blur-md shadow-xl border-0"
                  align="end"
                  sideOffset={8}
                >
                  <ProfilePlanHeader />
                  <ProfileStats />
                  <ProfileLogoutButton />
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
    </>
  )
} 