import React, { ReactNode, useCallback, useMemo, memo } from 'react';
import { Tree, File, Folder, type TreeViewElement } from '@/components/magicui/file-tree';
import { FileTreeItem } from '../types/app-preview';

/**
 * Memoized File Node Component
 * Prevents unnecessary re-renders of individual file items
 */
const MemoizedFile = memo(({
  id,
  name,
  onSelect,
}: {
  id: string;
  name: string;
  onSelect: (id: string) => void;
}) => (
  <File
    key={id}
    value={id}
    handleSelect={onSelect}
  >
    {name}
  </File>
));
MemoizedFile.displayName = 'MemoizedFile';

/**
 * Memoized Folder Node Component
 * Prevents unnecessary re-renders of folder items
 */
const MemoizedFolder = memo(({
  id,
  name,
  isLoading,
  children,
}: {
  id: string;
  name: string;
  isLoading: boolean;
  children: ReactNode;
}) => (
  <Folder
    key={id}
    element={isLoading ? `${name} (loading...)` : name}
    value={id}
  >
    {children}
  </Folder>
));
MemoizedFolder.displayName = 'MemoizedFolder';

interface FileTreeProps {
  files: FileTreeItem[];
  selectedFile: string | null;
  onFileSelect: (filePath: string) => void;
  onDirectoryToggle: (directoryPath: string) => void;
  expandedDirectories: Set<string>;
  loadingDirectories?: Set<string>;
  isLoading?: boolean;
  appType?: string;
}

/**
 * Optimized FileTree Component
 *
 * Key optimizations:
 * 1. Memoized tree element conversion (only recalculates when files change)
 * 2. Memoized node rendering with stable callbacks
 * 3. Efficient expanded path calculation
 * 4. No unnecessary re-renders from parent state changes
 */
export const FileTree: React.FC<FileTreeProps> = memo(({
  files,
  selectedFile,
  onFileSelect,
  onDirectoryToggle,
  expandedDirectories,
  loadingDirectories = new Set(),
  isLoading,
  appType = 'web'
}) => {
  const workspacePath = `/workspace/${appType === 'mobile' ? 'cheatcode-mobile' : 'cheatcode-app'}`;

  // Stable file select handler - doesn't change on re-render
  const handleFileSelect = useCallback((filePath: string) => {
    const relativePath = filePath.replace(`${workspacePath}/`, '');
    onFileSelect(relativePath);
  }, [onFileSelect, workspacePath]);

  // Stable directory toggle handler
  const handleTreeDirectoryToggle = useCallback((directoryPath: string) => {
    const relativePath = directoryPath.replace(`${workspacePath}/`, '');
    onDirectoryToggle(relativePath);
  }, [onDirectoryToggle, workspacePath]);

  // Convert files to TreeViewElement format - memoized
  const treeViewElements = useMemo(() => {
    const convertToTreeViewElements = (items: FileTreeItem[]): TreeViewElement[] => {
      return items.map((item) => {
        const fullPath = `${workspacePath}/${item.path}`;

        if (item.type === 'directory') {
          return {
            id: fullPath,
            name: item.name,
            children: item.children ? convertToTreeViewElements(item.children) : [],
          };
        } else {
          return {
            id: fullPath,
            name: item.name,
            isSelectable: true,
          };
        }
      });
    };

    return convertToTreeViewElements(files);
  }, [files, workspacePath]);

  // Calculate expanded paths - memoized with stable dependency
  const allExpandedPaths = useMemo(() => {
    const paths: string[] = [workspacePath]; // Always include root

    expandedDirectories.forEach(relativePath => {
      if (relativePath) {
        paths.push(`${workspacePath}/${relativePath}`);
      }
    });

    return paths;
  }, [workspacePath, expandedDirectories]);

  // Render tree nodes - using memo components
  const renderTreeNodes = useCallback((elements: TreeViewElement[]): ReactNode => {
    return elements.map((element) => {
      if (element.children !== undefined) {
        // Directory node
        const relativePath = element.id.replace(`${workspacePath}/`, '');
        const isNodeLoading = loadingDirectories.has(relativePath);

        return (
          <MemoizedFolder
            key={element.id}
            id={element.id}
            name={element.name}
            isLoading={isNodeLoading}
          >
            {element.children.length > 0 ? renderTreeNodes(element.children) : null}
          </MemoizedFolder>
        );
      } else {
        // File node
        return (
          <MemoizedFile
            key={element.id}
            id={element.id}
            name={element.name}
            onSelect={handleFileSelect}
          />
        );
      }
    });
  }, [handleFileSelect, workspacePath, loadingDirectories]);

  // Memoize rendered nodes
  const renderedNodes = useMemo(
    () => renderTreeNodes(treeViewElements),
    [renderTreeNodes, treeViewElements]
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="w-64 border-r border-zinc-200 dark:border-zinc-700/50 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700/50">
          <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
            Explorer
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center space-y-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              Loading project files...
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (files.length === 0) {
    return (
      <div className="w-64 border-r border-zinc-200 dark:border-zinc-700/50 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700/50">
          <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
            Explorer
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            No files found
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-64 border-r border-zinc-200 dark:border-zinc-700/50 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700/50 bg-white/60 dark:bg-zinc-800/60">
        <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
          Explorer
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto px-2 py-2 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-600 scrollbar-track-transparent hover:scrollbar-thumb-zinc-400 dark:hover:scrollbar-thumb-zinc-500 scrollbar-thumb-rounded-full">
          <Tree
            initialSelectedId={selectedFile ? `${workspacePath}/${selectedFile}` : undefined}
            initialExpandedItems={allExpandedPaths}
            className="w-full"
          >
            {renderedNodes}
          </Tree>
        </div>
      </div>
    </div>
  );
});

FileTree.displayName = 'FileTree';
