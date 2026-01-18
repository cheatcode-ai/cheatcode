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
  onDirectoryToggle: _onDirectoryToggle,
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

  // Note: Directory toggle handler is managed by Tree component internally
  // onDirectoryToggle is used when Tree detects folder expansion

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
      <div className="w-64 border-r border-zinc-200 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-950/20 backdrop-blur-sm flex flex-col">
        <div className="h-10 px-4 flex items-center border-b border-zinc-200 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-950/20 backdrop-blur-sm">
          <div className="text-[10px] font-mono font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
            Explorer
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center space-y-3">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-400"></div>
            <div className="text-xs font-mono text-zinc-500 dark:text-zinc-300">
              Loading...
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (files.length === 0) {
    return (
      <div className="w-64 border-r border-zinc-200 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-950/20 backdrop-blur-sm flex flex-col">
        <div className="h-10 px-4 flex items-center border-b border-zinc-200 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-950/20 backdrop-blur-sm">
          <div className="text-[10px] font-mono font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
            Explorer
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-xs font-mono text-zinc-500 dark:text-zinc-300 uppercase tracking-wide">
            No files found
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-64 border-r border-zinc-200 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-950/20 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="h-10 px-4 flex items-center border-b border-zinc-200 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-950/20 backdrop-blur-sm">
        <div className="text-[10px] font-mono font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
          Explorer
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-hidden bg-zinc-50 dark:bg-transparent">
        <div className="h-full overflow-y-auto px-0 py-2 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-800 scrollbar-track-transparent">
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
