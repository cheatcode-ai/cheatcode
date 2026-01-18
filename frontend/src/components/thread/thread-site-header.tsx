'use client';

import { Button } from "@/components/ui/button"
import { PanelRightOpen, Menu, Globe, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { CheatcodeLogo } from "@/components/sidebar/cheatcode-logo"
import { useUser } from '@clerk/nextjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClerkBackendApi } from '@/lib/api-client';
import { useAuth } from '@clerk/nextjs';
import { ExternalLink, Rocket } from 'lucide-react';

import { useState, useRef, KeyboardEvent, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { useUpdateProject } from "@/hooks/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/ui/sidebar"
import { threadKeys } from "@/hooks/react-query/threads/keys";

import { LiquidMetalButton } from "@/components/ui/liquid-metal-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Import our focused contexts
import { useThreadState } from "@/app/(home)/projects/[projectId]/thread/_contexts/ThreadStateContext";
import { useLayout } from "@/app/(home)/projects/[projectId]/thread/_contexts/LayoutContext";

// Consolidated components and utilities
import { IntegrationsDropdown } from '@/components/integrations/integrations-dropdown';
import { ProfileDropdown } from '@/components/user/profile-popover';

// Centralized thread color system
import { threadStyles } from '@/lib/theme/thread-colors';

export function SiteHeader() {
  // Get data from contexts instead of props
  const { projectId, projectName, project } = useThreadState();
  const { toggleSidePanel, isMobile, debugMode, handleProjectRenamed } = useLayout();

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
        "fixed top-0 left-0 right-0 flex h-14 shrink-0 items-center justify-between z-30 w-full",
        threadStyles.header,
        isMobile ? "px-4" : "px-6"
      )}>
        {/* Left side - Logo/hamburger and project name */}
        <div className="flex items-center gap-6">
          {/* Logo button to open sidebar when closed */}
          {leftSidebarState === 'collapsed' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLeftSidebarOpen(true)}
              className={cn("h-8 w-8 hover:bg-transparent p-0", threadStyles.buttonGhost)}
              aria-label="Open sidebar"
              title="Open sidebar"
            >
              <CheatcodeLogo size={20} />
            </Button>
          )}

          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpenMobile(true)}
              className={cn("h-8 w-8 hover:bg-transparent", threadStyles.buttonGhost)}
              aria-label="Open sidebar"
            >
              <Menu className="h-4 w-4" />
            </Button>
          )}

          <div className="flex items-center group/name-edit">
            {isEditing ? (
              <div className="flex items-center gap-0">
                <Input
                  ref={inputRef}
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={saveNewName}
                  className={cn(
                    "h-7 w-auto min-w-[200px] text-[11px] font-mono px-2 uppercase tracking-widest rounded-sm transition-all focus-visible:ring-1 focus-visible:ring-thread-border-hover",
                    threadStyles.input
                  )}
                  maxLength={50}
                />
              </div>
            ) : !projectName || projectName === 'Project' ? (
              <Skeleton className={cn("h-4 w-32", threadStyles.skeleton)} />
            ) : (
              <div
                className="flex items-center gap-2 px-2 py-1 -ml-2 rounded-sm hover:bg-thread-surface-subtle cursor-pointer transition-all"
                onClick={startEditing}
                title="Click to rename project"
              >
                <div className="text-[11px] font-mono text-thread-text-secondary group-hover/name-edit:text-thread-text-primary transition-colors tracking-[0.2em] uppercase font-bold">
                  {projectName}
                </div>
                <div className="opacity-0 group-hover/name-edit:opacity-100 transition-opacity duration-200">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-thread-text-muted"
                    >
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right side - Action buttons pushed to extreme right */}
        <div className="flex items-center gap-6">
          {/* Debug mode indicator */}
          {debugMode && (
            <div className="text-[10px] font-mono text-thread-status-warning uppercase tracking-widest opacity-80">
              DEBUG MODE
            </div>
          )}

          {/* Action buttons on the extreme right */}
          {!isMobile && (
            <div className="flex items-center gap-4">
              {/* Hide deploy controls entirely for mobile app type */}
              {projectId && project?.app_type === 'mobile' ? null : isLoadingDeploymentStatus ? (
                <Skeleton className={cn("h-8 w-24 rounded-md", threadStyles.skeleton)} />
              ) : (
                (deploymentStatus as any)?.has_deployment ? (
                  <Popover open={deployPopoverOpen} onOpenChange={setDeployPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          "h-8 pl-2.5 pr-3 flex items-center gap-2 rounded-md transition-all group shadow-sm text-[11px] font-mono uppercase tracking-wider",
                          threadStyles.buttonOutline
                        )}
                      >
                         <div className={cn(
                           "h-1.5 w-1.5 rounded-full",
                           (isDeploying || isUpdatingDeployment)
                             ? threadStyles.statusDotWarning
                             : threadStyles.statusDotActive
                         )}></div>
                        {(isDeploying || isUpdatingDeployment) ? 'Deploying...' : 'Deployed'}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className={cn("w-80 rounded-lg shadow-2xl p-0 overflow-hidden font-mono", threadStyles.card)}>
                      <div className="p-5 space-y-4">
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <h4 className="text-xs font-medium text-thread-text-primary uppercase tracking-wide">Deployment</h4>
                            <span className={cn(
                              "text-[9px] font-mono px-1.5 py-0.5 rounded-sm border",
                              (isDeploying || isUpdatingDeployment)
                                ? threadStyles.statusBadgeWarning
                                : threadStyles.statusBadgeSuccess
                            )}>
                              {(isDeploying || isUpdatingDeployment) ? 'IN PROGRESS' : 'ACTIVE'}
                            </span>
                          </div>
                          <p className="text-[10px] text-thread-text-tertiary leading-normal">
                            Manage your project's live deployment and view status.
                          </p>
                        </div>
                        
                        {/* Progress bar during deployment/redeployment */}
                        {(isDeploying || isUpdatingDeployment) && (
                          <div className="space-y-2 py-1">
                            <div className="flex items-center justify-between text-[10px] font-mono text-thread-text-secondary uppercase tracking-wider">
                              <span>
                                {liveStatus?.state === 'preparing' ? 'Preparing...' :
                                 liveStatus?.state === 'pushing' ? 'Pushing...' :
                                 liveStatus?.state === 'building' ? 'Building...' :
                                 liveStatus?.state === 'deploying' ? 'Deploying...' :
                                 isUpdatingDeployment ? 'Redeploying...' : 'Preparing...'}
                              </span>
                              <span>{Math.round(deployProgress)}%</span>
                            </div>
                            <div className="h-0.5 bg-thread-surface rounded-full overflow-hidden">
                              <div
                                className="h-full bg-thread-text-primary rounded-full transition-all duration-300 ease-out"
                                style={{ width: `${deployProgress}%` }}
                              />
                            </div>
                          </div>
                        )}
                        
                        {/* Deployed site link */}
                        {(deploymentStatus as any)?.domains && (deploymentStatus as any).domains.length > 0 && (
                          <div className="space-y-2">
                            {(deploymentStatus as any).domains.map((domain: string, index: number) => (
                              <a
                                key={index}
                                href={`https://${domain}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-thread-text-secondary hover:text-thread-text-primary transition-colors group"
                              >
                                <Globe className="w-3.5 h-3.5" />
                                <span className="text-xs truncate font-mono underline decoration-thread-border underline-offset-4 group-hover:decoration-thread-text-tertiary">{domain}</span>
                                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </a>
                            ))}
                          </div>
                        )}

                        {/* Liquid Metal Button */}
                        <LiquidMetalButton
                          className="w-full"
                          onClick={async () => {
                            if (!projectId) {
                              toast.error('Missing project ID');
                              return;
                            }
                            try {
                              setIsUpdatingDeployment(true);
                              const apiClient = createClerkBackendApi(getToken);
                              await apiClient.post(`/project/${projectId}/deploy/git/update`, {}, {
                                timeout: 600000,
                              });
                              toast.success('Deployment update triggered');
                              setDeployPopoverOpen(false);
                              queryClient.invalidateQueries({ queryKey: ['deployment-status', projectId] });
                            } catch (e) {
                              toast.error('Failed to trigger deployment update');
                            } finally {
                              setIsUpdatingDeployment(false);
                            }
                          }}
                          disabled={isUpdatingDeployment}
                        >
                          {isUpdatingDeployment ? (
                            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5 mr-2" />
                          )}
                          <span className="whitespace-nowrap">Redeploy Project</span>
                        </LiquidMetalButton>
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Popover open={deployPopoverOpen} onOpenChange={setDeployPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          "h-8 pl-2.5 pr-3 flex items-center gap-2 rounded-md transition-all group shadow-sm text-[11px] font-mono uppercase tracking-wider",
                          threadStyles.buttonOutline
                        )}
                      >
                        <Rocket className={`w-3.5 h-3.5 ${isDeploying ? 'animate-pulse' : ''}`} />
                        {isDeploying ? 'Deploying...' : 'Deploy'}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className={cn("w-80 rounded-lg shadow-2xl p-0 overflow-hidden font-mono", threadStyles.card)}>
                      <div className="p-5 space-y-5">
                        <div>
                          <h4 className="text-xs font-medium text-thread-text-primary uppercase tracking-wide">Deploy Project</h4>
                          <p className="text-[10px] text-thread-text-tertiary mt-1.5 leading-normal">
                            Deploy your project to get a live URL accessible from anywhere.
                          </p>
                        </div>

                        {/* Progress bar during deployment */}
                        {isDeploying && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-thread-text-tertiary">
                              <span>
                                {liveStatus?.state === 'preparing' ? 'Preparing' :
                                 liveStatus?.state === 'pushing' ? 'Pushing' :
                                 liveStatus?.state === 'building' ? 'Building' :
                                 liveStatus?.state === 'deploying' ? 'Deploying' : 'Preparing'}
                              </span>
                              <span>{Math.round(deployProgress)}%</span>
                            </div>
                            <div className="h-0.5 bg-thread-surface rounded-full overflow-hidden">
                              <div
                                className="h-full bg-thread-text-primary rounded-full transition-all duration-300 ease-out"
                                style={{ width: `${deployProgress}%` }}
                              />
                            </div>
                          </div>
                        )}
                        <LiquidMetalButton
                          className="w-full"
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
                              toast.error('Deployment failed');
                            } finally {
                              setIsDeploying(false);
                            }
                          }}
                          disabled={isDeploying}
                        >
                          {isDeploying ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Rocket className="w-3.5 h-3.5" />
                          )}
                          <span className="whitespace-nowrap">{isDeploying ? 'Deploying...' : 'Deploy Now'}</span>
                        </LiquidMetalButton>
                      </div>
                    </PopoverContent>
                  </Popover>
                )
              )}
              
              {/* Integrations Dropdown - Simplified */}
              <IntegrationsDropdown triggerVariant="ghost" />
            </div>
          )}

          {/* User Profile */}
          {user && !isMobile && (
            <ProfileDropdown
              user={{
                imageUrl: user.imageUrl,
                fullName: user.fullName,
                firstName: user.firstName,
                email: user.emailAddresses[0]?.emailAddress,
              }}
            />
          )}

          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidePanel}
              className={cn("h-8 w-8 cursor-pointer", threadStyles.buttonGhost)}
              aria-label="Toggle computer panel"
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>
    </>
  )
}