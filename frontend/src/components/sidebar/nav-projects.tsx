'use client';

import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Link as LinkIcon,
  MoreHorizontal,
  Trash2,
  MessagesSquare,
  Loader2,
  X,
  Check,
  History
} from "lucide-react"
import { toast } from "sonner"
import { usePathname, useRouter } from "next/navigation"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import Link from "next/link"
import { DeleteConfirmationDialog } from "@/components/thread/DeleteConfirmationDialog"
import { useDeleteOperation } from '@/contexts/DeleteOperationContext'
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ThreadWithProject } from '@/hooks/react-query/sidebar/use-sidebar';
import { Monitor, Smartphone } from 'lucide-react';
import { processThreadsWithProjects, useDeleteMultipleThreads, useDeleteThread, useProjects, useThreads } from '@/hooks/react-query/sidebar/use-sidebar';
import { Thread, Project } from '@/lib/api';
import { projectKeys, threadKeys } from '@/hooks/react-query/sidebar/keys';
import { useDeleteProject } from '@/hooks/react-query/sidebar/use-project-mutations';

export function NavProjects() {
  const { isMobile, state, setOpen, setOpenMobile } = useSidebar()
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null)
  const pathname = usePathname()
  const router = useRouter()
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [threadToDelete, setThreadToDelete] = useState<{ id: string; name: string } | null>(null)
  const isNavigatingRef = useRef(false)
  const { performDelete } = useDeleteOperation();
  const isPerformingActionRef = useRef(false);
  const queryClient = useQueryClient();

  const [selectedThreads, setSelectedThreads] = useState<Set<string>>(new Set());
  const [deleteProgress, setDeleteProgress] = useState(0);
  const [totalToDelete, setTotalToDelete] = useState(0);

  const {
    data: projects = [],
    isLoading: isProjectsLoading,
    error: projectsError
  } = useProjects();

  const {
    data: threads = [],
    isLoading: isThreadsLoading,
    error: threadsError
  } = useThreads();

  const { mutate: deleteThreadMutation, isPending: isDeletingSingle } = useDeleteThread();
  const {
    mutate: deleteMultipleThreadsMutation,
    isPending: isDeletingMultiple
  } = useDeleteMultipleThreads();
  const { mutate: deleteProjectMutation, isPending: isDeletingProject } = useDeleteProject();

  // Helper function to ensure all projects are shown
  const processAllProjects = (threads: Thread[], projects: Project[]): ThreadWithProject[] => {
    const threadsWithProjects = processThreadsWithProjects(threads, projects);
    const projectsWithThreads = new Set(threadsWithProjects.map(t => t.projectId));
    
    // Add projects without threads
    const projectsWithoutThreads = projects
      .filter(project => !projectsWithThreads.has(project.id))
      .map(project => ({
        threadId: `no-thread-${project.id}`, // Unique identifier for projects without threads
        projectId: project.id,
        projectName: project.name || 'Unnamed Project',
        appType: project.app_type || 'web', // Add missing appType
        url: `/projects/${project.id}`, // Direct project URL
        updatedAt: project.updated_at || new Date().toISOString(),
      }));
    
    return [...threadsWithProjects, ...projectsWithoutThreads];
  };

  // Create a list that includes ALL projects, not just those with threads
  const combinedThreads: ThreadWithProject[] =
    !isProjectsLoading && !isThreadsLoading ?
      processAllProjects(threads, projects) : [];

  const handleDeletionProgress = (completed: number, total: number) => {
    const percentage = (completed / total) * 100;
    setDeleteProgress(percentage);
  };

  useEffect(() => {
    const handleProjectUpdate = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        const { projectId, updatedData } = customEvent.detail;
        queryClient.invalidateQueries({ queryKey: projectKeys.details(projectId) });
        queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      }
    };

    window.addEventListener('project-updated', handleProjectUpdate as EventListener);
    return () => {
      window.removeEventListener(
        'project-updated',
        handleProjectUpdate as EventListener,
      );
    };
  }, [queryClient]);

  useEffect(() => {
    setLoadingThreadId(null);
  }, [pathname]);

  useEffect(() => {
    const handleNavigationComplete = () => {
      console.log('NAVIGATION - Navigation event completed');
      document.body.style.pointerEvents = 'auto';
      isNavigatingRef.current = false;
    };

    window.addEventListener("popstate", handleNavigationComplete);

    return () => {
      window.removeEventListener('popstate', handleNavigationComplete);
      // Ensure we clean up any leftover styles
      document.body.style.pointerEvents = "auto";
    };
  }, []);

  // Reset isNavigatingRef when pathname changes
  useEffect(() => {
    isNavigatingRef.current = false;
    document.body.style.pointerEvents = 'auto';
  }, [pathname]);



  // Function to handle thread click with loading state
  const handleThreadClick = (e: React.MouseEvent<HTMLAnchorElement>, threadId: string, url: string) => {
    // If thread is selected, prevent navigation 
    if (selectedThreads.has(threadId)) {
      e.preventDefault();
      return;
    }

    e.preventDefault();
    setLoadingThreadId(threadId);
    // Close the sidebar immediately so the main view isn’t offset
    if (isMobile) {
      setOpenMobile(false);
    } else {
      setOpen(false);
    }
    router.push(url);
  }

  // Toggle thread selection for multi-select
  const toggleThreadSelection = (threadId: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    setSelectedThreads(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(threadId)) {
        newSelection.delete(threadId);
      } else {
        newSelection.add(threadId);
      }
      return newSelection;
    });
  };

  // Select all threads
  const selectAllThreads = () => {
    const allThreadIds = combinedThreads.map(thread => thread.threadId);
    setSelectedThreads(new Set(allThreadIds));
  };

  // Deselect all threads
  const deselectAllThreads = () => {
    setSelectedThreads(new Set());
  };

  // Function to handle project deletion
  const handleDeleteProject = async (projectId: string, projectName: string) => {
    setThreadToDelete({ id: `project-${projectId}`, name: `project: ${projectName}` });
    setIsDeleteDialogOpen(true);
  };

  // Function to handle multi-delete
  const handleMultiDelete = () => {
    if (selectedThreads.size === 0) return;

    // Get thread names for confirmation dialog
    const threadsToDelete = combinedThreads.filter(t => selectedThreads.has(t.threadId));
    const threadNames = threadsToDelete.map(t => t.projectName).join(", ");

    setThreadToDelete({
      id: "multiple",
      name: selectedThreads.size > 3
        ? `${selectedThreads.size} conversations`
        : threadNames
    });

    setTotalToDelete(selectedThreads.size);
    setDeleteProgress(0);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!threadToDelete || isPerformingActionRef.current) return;

    // Mark action in progress
    isPerformingActionRef.current = true;

    // Close dialog first for immediate feedback
    setIsDeleteDialogOpen(false);

    // Check if it's a project deletion or multiple threads
    if (threadToDelete.id.startsWith('project-')) {
      // Project deletion
      const projectId = threadToDelete.id.replace('project-', '');
      const isCurrentProject = pathname?.includes(projectId);

      try {
        // Navigate away if deleting current project
        if (isCurrentProject) {
          isNavigatingRef.current = true;
          document.body.style.pointerEvents = 'none';
          router.push('/');
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Delete the project
        deleteProjectMutation(
          { projectId },
            {
              onSuccess: () => {
              // Invalidate all related queries
              queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
                queryClient.invalidateQueries({ queryKey: threadKeys.lists() });
              toast.success('Project deleted successfully');
              },
              onSettled: () => {
                setThreadToDelete(null);
                isPerformingActionRef.current = false;
              document.body.style.pointerEvents = 'auto';
            }
            }
          );
      } catch (error) {
        console.error('Project deletion failed:', error);
          setThreadToDelete(null);
          isPerformingActionRef.current = false;
        document.body.style.pointerEvents = 'auto';
      }
    } else {
      // Multi-thread deletion - filter out fake thread IDs for projects without threads
      const threadIdsToDelete = Array.from(selectedThreads).filter(id => !id.startsWith('no-thread-'));
      const projectsWithoutThreadsSelected = Array.from(selectedThreads).filter(id => id.startsWith('no-thread-')).length;
      
      // If no real threads are selected, show error
      if (threadIdsToDelete.length === 0) {
        toast.error(projectsWithoutThreadsSelected > 0 
          ? 'Projects without conversations must be deleted individually using "Delete Project"'
          : 'No conversations selected for deletion');
        isPerformingActionRef.current = false;
        setThreadToDelete(null);
        return;
      }
      
      // Warn if some projects without threads were selected
      if (projectsWithoutThreadsSelected > 0) {
        toast.warning(`${projectsWithoutThreadsSelected} project(s) without conversations will be skipped. Use "Delete Project" to delete them.`);
      }

      const isActiveThreadIncluded = threadIdsToDelete.some(id => pathname?.includes(id));

      // Show initial toast
      toast.info(`Deleting ${threadIdsToDelete.length} conversations...`);

      try {
        // If the active thread is included, handle navigation first
        if (isActiveThreadIncluded) {
          // Navigate to home before deleting
          isNavigatingRef.current = true;
          document.body.style.pointerEvents = 'none';
          router.push('/');

          // Wait a moment for navigation to start
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Use the mutation for bulk deletion
        deleteMultipleThreadsMutation(
          {
            threadIds: threadIdsToDelete,
            threadSandboxMap: Object.fromEntries(
              threadIdsToDelete.map(threadId => {
                const thread = combinedThreads.find(t => t.threadId === threadId);
                const project = projects.find(p => p.id === thread?.projectId);
                return [threadId, project?.sandbox?.id || ''];
              }).filter(([, sandboxId]) => sandboxId)
            ),
            onProgress: handleDeletionProgress
          },
          {
            onSuccess: (data) => {
              // Invalidate queries to refresh the list
              queryClient.invalidateQueries({ queryKey: threadKeys.lists() });

              // Show success message
              toast.success(`Successfully deleted ${data.successful.length} conversations`);

              // If some deletions failed, show warning
              if (data.failed.length > 0) {
                toast.warning(`Failed to delete ${data.failed.length} conversations`);
              }

              // Reset states
              setSelectedThreads(new Set());
              setDeleteProgress(0);
              setTotalToDelete(0);
            },
            onError: (error) => {
              console.error('Error in bulk deletion:', error);
              toast.error('Error deleting conversations');
            },
            onSettled: () => {
              setThreadToDelete(null);
              isPerformingActionRef.current = false;
              setDeleteProgress(0);
              setTotalToDelete(0);
            }
          }
        );
      } catch (err) {
        console.error('Error initiating bulk deletion:', err);
        toast.error('Error initiating deletion process');

        // Reset states
        setSelectedThreads(new Set());
        setThreadToDelete(null);
        isPerformingActionRef.current = false;
        setDeleteProgress(0);
        setTotalToDelete(0);
      }
    }
  };

  // Loading state or error handling
  const isLoading = isProjectsLoading || isThreadsLoading;
  const hasError = projectsError || threadsError;

  if (hasError) {
    console.error('Error loading data:', { projectsError, threadsError });
  }

  return (
    <SidebarGroup>
      <div className="flex justify-between items-center">
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        {state !== 'collapsed' ? (
          <div className="flex items-center space-x-1">
            {selectedThreads.size > 0 ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={deselectAllThreads}
                  className="h-7 w-7"
                >
                  <X className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={selectAllThreads}
                  disabled={selectedThreads.size === combinedThreads.length}
                  className="h-7 w-7"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleMultiDelete}
                  className="h-7 w-7 text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <SidebarMenu className="overflow-y-auto max-h-[calc(100vh-200px)] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">


        {state !== 'collapsed' && (
          <>
            {isLoading ? (
              // Show skeleton loaders while loading
              Array.from({ length: 3 }).map((_, index) => (
                <SidebarMenuItem key={`skeleton-${index}`}>
                  <SidebarMenuButton>
                    <div className="h-4 w-4 bg-sidebar-foreground/10 rounded-md animate-pulse"></div>
                    <div className="h-3 bg-sidebar-foreground/10 rounded w-3/4 animate-pulse"></div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))
            ) : combinedThreads.length > 0 ? (
              // Show all threads with project info
              <>
                {combinedThreads.map((thread) => {
                  // Check if this thread is currently active
                  const isActive = pathname?.includes(thread.threadId) || false;
                  const isThreadLoading = loadingThreadId === thread.threadId;
                  const isSelected = selectedThreads.has(thread.threadId);

                  return (
                    <SidebarMenuItem key={`thread-${thread.threadId}`} className="group/row">
                      <SidebarMenuButton
                        asChild
                        className={`relative ${isActive
                          ? 'bg-accent text-accent-foreground font-medium'
                          : isSelected
                            ? 'bg-primary/10'
                            : ''
                          }`}
                      >
                        <div className="flex items-center w-full">
                          <Link
                            href={thread.url}
                            onClick={(e) =>
                              handleThreadClick(e, thread.threadId, thread.url)
                            }
                            className="flex items-center flex-1 min-w-0"
                          >
                            {isThreadLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2 flex-shrink-0" />
                            ) : (
                              <span className="mr-2 flex-shrink-0">
                                {thread.appType === 'mobile' ? (
                                  <Smartphone className="h-4 w-4 text-green-500" />
                                ) : (
                                  <Monitor className="h-4 w-4 text-orange-500" />
                                )}
                              </span>
                            )}
                            <span className="truncate">{thread.projectName}</span>
                          </Link>
                          
                          {/* Checkbox - only visible on hover of this specific area */}
                          <div
                            className="mr-1 flex-shrink-0 w-4 h-4 flex items-center justify-center group/checkbox"
                            onClick={(e) => toggleThreadSelection(thread.threadId, e)}
                          >
                            <div
                              className={`h-4 w-4 border rounded cursor-pointer transition-all duration-150 flex items-center justify-center ${isSelected
                                ? 'opacity-100 bg-primary border-primary hover:bg-primary/90'
                                : 'opacity-0 group-hover/checkbox:opacity-100 border-muted-foreground/30 bg-background hover:bg-muted/50'
                                }`}
                            >
                              {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                            </div>
                          </div>

                          {/* Dropdown Menu - inline with content */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="flex-shrink-0 w-6 h-6 flex items-center justify-center hover:bg-muted/50 rounded transition-all duration-150 text-muted-foreground hover:text-foreground opacity-0 group-hover/row:opacity-100"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">More actions</span>
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              className="w-56 rounded-lg z-50"
                              side={isMobile ? 'bottom' : 'right'}
                              align={isMobile ? 'end' : 'start'}
                              onCloseAutoFocus={(e) => e.preventDefault()}
                            >
                              <DropdownMenuItem asChild>
                                <a
                                  href={`/projects/${thread.projectId}/thread/${thread.threadId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex cursor-pointer items-center gap-2"
                                  onClick={(e) => {
                                    // prevent the row Link from navigating
                                    e.stopPropagation();
                                  }}
                                >
                                  <ArrowUpRight className="text-muted-foreground" />
                                  <span>Open in New Tab</span>
                                </a>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDeleteProject(thread.projectId, thread.projectName);
                                }}
                                className="cursor-pointer flex items-center gap-2 text-destructive"
                              >
                                <Trash2 className="text-destructive" />
                                <span>Delete Project</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </>
            ) : (
              <SidebarMenuItem>
                <SidebarMenuButton className="text-sidebar-foreground/70">
                  <span>No projects yet</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </>
        )}
      </SidebarMenu>

      {(isDeletingSingle || isDeletingMultiple || isDeletingProject) && totalToDelete > 0 && (
        <div className="mt-2 px-2">
          <div className="text-xs text-muted-foreground mb-1">
            Deleting {deleteProgress > 0 ? `(${Math.floor(deleteProgress)}%)` : '...'}
          </div>
          <div className="w-full bg-secondary h-1 rounded-full overflow-hidden">
            <div
              className="bg-primary h-1 transition-all duration-300 ease-in-out"
              style={{ width: `${deleteProgress}%` }}
            />
          </div>
        </div>
      )}

      {threadToDelete && (
        <DeleteConfirmationDialog
          isOpen={isDeleteDialogOpen}
          onClose={() => setIsDeleteDialogOpen(false)}
          onConfirm={confirmDelete}
          threadName={threadToDelete.name}
          isDeleting={isDeletingSingle || isDeletingMultiple || isDeletingProject}
        />
      )}
    </SidebarGroup>
  );
}