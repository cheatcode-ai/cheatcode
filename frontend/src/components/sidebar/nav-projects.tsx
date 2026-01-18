'use client';

import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Link as LinkIcon,
  MoreHorizontal,
  Trash2,
  Loader2,
  X,
  Check
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
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import Link from "next/link"
import { DeleteConfirmationDialog } from "@/components/thread/DeleteConfirmationDialog"
import { Button } from "@/components/ui/button"
import { ThreadWithProject } from '@/hooks/react-query/sidebar/use-sidebar';
import { Monitor, Smartphone } from 'lucide-react';
import { processThreadsWithProjects, useDeleteMultipleThreads, useDeleteThread, useProjects, useThreads } from '@/hooks/react-query/sidebar/use-sidebar';
import { Thread, Project } from '@/lib/api';
import { projectKeys, threadKeys } from '@/hooks/react-query/sidebar/keys';
import { useDeleteProject } from '@/hooks/react-query/sidebar/use-project-mutations';

export function NavProjects() {
  const { isMobile, state, setOpen } = useSidebar()
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null)
  const pathname = usePathname()
  const router = useRouter()
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [threadToDelete, setThreadToDelete] = useState<{ id: string; name: string; type: 'project' | 'conversation' | 'multiple' } | null>(null)
  const isNavigatingRef = useRef(false)
  const isPerformingActionRef = useRef(false);
  const queryClient = useQueryClient();

  const [selectedThreads, setSelectedThreads] = useState<Set<string>>(new Set());
  const [deleteProgress, setDeleteProgress] = useState(0);
  const [totalToDelete, setTotalToDelete] = useState(0);

  const {
    data: projects = [],
    isLoading: isProjectsLoading,
  } = useProjects();

  const {
    data: threads = [],
    isLoading: isThreadsLoading,
  } = useThreads();

  const { isPending: _isDeletingSingle } = useDeleteThread();
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
        const { projectId } = customEvent.detail;
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
    // Close the sidebar immediately so the main view isn't offset
    // Use setOpen for both mobile and desktop since our custom sidebar uses CSS transforms based on state (derived from open)
    setOpen(false);
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
    setThreadToDelete({ id: `project-${projectId}`, name: projectName, type: 'project' });
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
        : threadNames,
      type: 'multiple'
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
            onError: () => {
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
      } catch {
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
  // Error state available via projectsError || threadsError if needed

  return (
    <SidebarGroup className="p-0">
      {/* Grid Header Cell */}
      <div className="flex h-10 items-center justify-between px-4 border-b border-zinc-800 bg-zinc-950">
        <SidebarGroupLabel className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
          Projects
        </SidebarGroupLabel>
        {state !== 'collapsed' && selectedThreads.size > 0 && (
          <div className="flex items-center gap-2 animate-in fade-in duration-200">
            <Button
              variant="ghost"
              size="icon"
              onClick={deselectAllThreads}
              className="h-5 w-5 text-zinc-500 hover:text-white hover:bg-transparent"
            >
              <X className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={selectAllThreads}
              className="h-5 w-5 text-zinc-500 hover:text-white hover:bg-transparent"
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleMultiDelete}
              className="h-5 w-5 text-zinc-500 hover:text-red-500 hover:bg-transparent"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      <SidebarMenu className="gap-0">
        {state !== 'collapsed' && (
          <>
            {isLoading ? (
              // Minimal skeleton rows
              Array.from({ length: 3 }).map((_, index) => (
                <SidebarMenuItem key={`skeleton-${index}`}>
                  <div className="h-12 w-full border-b border-zinc-900 bg-zinc-950/30 animate-pulse" />
                </SidebarMenuItem>
              ))
            ) : combinedThreads.length > 0 ? (
              // Project List - Grid Rows
              <>
                {combinedThreads.map((thread) => {
                  const isActive = pathname?.includes(thread.threadId) || false;
                  const isThreadLoading = loadingThreadId === thread.threadId;
                  const isSelected = selectedThreads.has(thread.threadId);

                  return (
                    <SidebarMenuItem key={`thread-${thread.threadId}`} className="group/row">
                      <SidebarMenuButton
                        asChild
                        className={`relative w-full justify-start py-6 px-4 rounded-none border-b border-zinc-800/50 transition-colors duration-150
                          ${isActive
                            ? 'bg-zinc-900 text-white border-l-2 border-l-white border-b-zinc-800'
                            : isSelected
                              ? 'bg-zinc-900/50 text-white border-l-2 border-l-zinc-500'
                              : 'text-zinc-500 hover:text-white hover:bg-zinc-900/30 border-l-2 border-l-transparent'
                          }`}
                      >
                        <div className="flex items-center w-full gap-3">
                          <Link
                            href={thread.url}
                            onClick={(e) =>
                              handleThreadClick(e, thread.threadId, thread.url)
                            }
                            className="flex items-center flex-1 min-w-0 gap-3 group/link"
                          >
                            <div className="flex-shrink-0">
                              {isThreadLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
                              ) : (
                                <>
                                  {thread.appType === 'mobile' ? (
                                    <Smartphone className={`h-4 w-4 transition-colors ${isActive ? 'text-white' : 'text-zinc-600 group-hover/row:text-zinc-400'}`} />
                                  ) : (
                                    <Monitor className={`h-4 w-4 transition-colors ${isActive ? 'text-white' : 'text-zinc-600 group-hover/row:text-zinc-400'}`} />
                                  )}
                                </>
                              )}
                            </div>
                            
                            <span className={`truncate text-sm font-medium ${isActive ? 'text-white' : 'text-zinc-500 group-hover/row:text-zinc-300'}`}>
                              {thread.projectName}
                            </span>
                          </Link>
                          
                          <div className="flex items-center gap-2 opacity-0 group-hover/row:opacity-100 transition-opacity duration-200">
                            {/* Checkbox */}
                            <button
                              className="h-6 w-6 flex items-center justify-center transition-colors"
                              onClick={(e) => toggleThreadSelection(thread.threadId, e)}
                            >
                              <div
                                className={`h-3 w-3 border flex items-center justify-center transition-all rounded-sm
                                  ${isSelected
                                    ? 'bg-white border-white'
                                    : 'border-zinc-600 hover:border-white bg-transparent'
                                  }`}
                              >
                                {isSelected && <Check className="h-2 w-2 text-black" />}
                              </div>
                            </button>

                            {/* Dropdown Menu */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="h-6 w-6 flex items-center justify-center text-zinc-600 hover:text-white transition-colors"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                className="w-56 rounded-md bg-zinc-950 border border-zinc-800 p-0"
                                side={isMobile ? 'bottom' : 'right'}
                                align={isMobile ? 'end' : 'start'}
                                onCloseAutoFocus={(e) => e.preventDefault()}
                              >
                                <DropdownMenuItem asChild className="rounded-none focus:bg-zinc-900 focus:text-white cursor-pointer py-2.5 px-3 border-b border-zinc-900 last:border-0">
                                  <a
                                    href={thread.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-3 text-zinc-400 text-xs font-mono uppercase tracking-wide"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <ArrowUpRight className="h-3.5 w-3.5" />
                                    <span>Open in New Tab</span>
                                  </a>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => {
                                    const fullUrl = `${window.location.origin}${thread.url}`;
                                    navigator.clipboard.writeText(fullUrl).then(() => {
                                      toast.success('Link copied to clipboard');
                                    }).catch(() => {
                                      toast.error('Failed to copy link');
                                    });
                                  }}
                                  className="rounded-none focus:bg-zinc-900 focus:text-white cursor-pointer py-2.5 px-3 border-b border-zinc-900 last:border-0 flex items-center gap-3 text-zinc-400 text-xs font-mono uppercase tracking-wide"
                                >
                                  <LinkIcon className="h-3.5 w-3.5" />
                                  <span>Copy Link</span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-zinc-800 my-0" />
                                <DropdownMenuItem
                                  onSelect={() => {
                                    handleDeleteProject(thread.projectId, thread.projectName);
                                  }}
                                  className="rounded-none focus:bg-red-950/30 focus:text-red-400 cursor-pointer py-2.5 px-3 border-b border-zinc-900 last:border-0 flex items-center gap-3 text-zinc-400 hover:text-red-400 text-xs font-mono uppercase tracking-wide"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span>Delete Project</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </>
            ) : (
              <SidebarMenuItem>
                <div className="px-4 py-8 text-center border-b border-zinc-900">
                  <p className="text-xs font-mono text-zinc-600 uppercase tracking-wide">No projects initialized</p>
                </div>
              </SidebarMenuItem>
            )}
          </>
        )}
      </SidebarMenu>

      {(_isDeletingSingle || isDeletingMultiple || isDeletingProject) && totalToDelete > 0 && (
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
          isDeleting={_isDeletingSingle || isDeletingMultiple || isDeletingProject}
          deleteType={threadToDelete.type}
        />
      )}
    </SidebarGroup>
  );
}