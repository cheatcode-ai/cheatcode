import React, { ReactNode, useCallback, useMemo, useEffect, useRef } from 'react';
import { Tree, File, Folder, type TreeViewElement } from '@/components/magicui/file-tree';
import { FileTreeItem } from '../types/app-preview';

// Custom Tree component that intercepts directory clicks
interface CustomTreeProps {
  initialSelectedId?: string;
  initialExpandedItems?: string[];
  className?: string;
  onDirectoryToggle: (directoryPath: string) => void;
  children: ReactNode;
}

const CustomTree: React.FC<CustomTreeProps> = ({ 
  initialSelectedId, 
  initialExpandedItems, 
  className, 
  onDirectoryToggle, 
  children 
}) => {
  const treeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // Find the closest button element (which is the directory toggle)
      const button = target.closest('button[data-state]');
      if (button) {
        const accordionItem = button.closest('[data-radix-accordion-item]');
        if (accordionItem) {
          const value = accordionItem.getAttribute('data-value');
          if (value) {
            // This is a directory being toggled
            onDirectoryToggle(value);
          }
        }
      }
    };

    const treeElement = treeRef.current;
    if (treeElement) {
      treeElement.addEventListener('click', handleClick);
      return () => treeElement.removeEventListener('click', handleClick);
    }
  }, [onDirectoryToggle]);

  return (
    <div ref={treeRef}>
      <Tree 
        initialSelectedId={initialSelectedId}
        initialExpandedItems={initialExpandedItems}
        className={className}
      >
        {children}
      </Tree>
    </div>
  );
};

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

export const FileTree: React.FC<FileTreeProps> = ({ 
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

  // Handle file selection
  const handleFileSelect = useCallback((filePath: string) => {
    const relativePath = filePath.replace(`${workspacePath}/`, '');
    onFileSelect(relativePath);
  }, [onFileSelect, workspacePath]);

  // Handle directory toggle from file tree
  const handleTreeDirectoryToggle = useCallback((directoryPath: string) => {
    const relativePath = directoryPath.replace(`${workspacePath}/`, '');
    onDirectoryToggle(relativePath);
  }, [onDirectoryToggle, workspacePath]);

  // Convert files to TreeViewElement format recursively
  const convertToTreeViewElements = useCallback((files: FileTreeItem[]): TreeViewElement[] => {
    return files.map((item) => {
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
  }, [workspacePath]);

  const treeViewElements = useMemo(() => {
    return convertToTreeViewElements(files);
  }, [files, convertToTreeViewElements]);

  // Get expanded paths based on expandedDirectories state  
  const allExpandedPaths = useMemo(() => {
    const paths: string[] = [];
    
    // Always include the root workspace path
    paths.push(workspacePath);
    
    // Convert relative paths to full paths for expanded directories
    expandedDirectories.forEach(relativePath => {
      if (relativePath) { // Skip empty string
        const fullPath = `${workspacePath}/${relativePath}`;
        paths.push(fullPath);
      }
    });
    
    return paths;
  }, [workspacePath, expandedDirectories]);

  const renderTreeNodes = useCallback((elements: TreeViewElement[]): ReactNode => {
    return elements.map((element) => {
      if (element.children !== undefined) {
        // This is a directory
        const relativePath = element.id.replace(`${workspacePath}/`, '');
        const isLoading = loadingDirectories.has(relativePath);
        
        return (
          <Folder 
            key={element.id} 
            element={isLoading ? `${element.name} (loading...)` : element.name}
            value={element.id}

          >
            {element.children.length > 0 ? renderTreeNodes(element.children) : null}
          </Folder>
        );
      } else {
        // This is a file
        return (
          <File 
            key={element.id}
            value={element.id} 
            handleSelect={handleFileSelect}
          >
            {element.name}
          </File>
        );
      }
    });
  }, [handleFileSelect, workspacePath, loadingDirectories, handleTreeDirectoryToggle]);

  if (isLoading) {
    return (
      <div className="w-64 border-r border-zinc-200 dark:border-zinc-700/50 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700/50">
          <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
            Explorer
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            Loading project files...
          </div>
        </div>
      </div>
    );
  }

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
      
      {/* File Tree with Custom Scrollbar */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto px-2 py-2 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-600 scrollbar-track-transparent hover:scrollbar-thumb-zinc-400 dark:hover:scrollbar-thumb-zinc-500 scrollbar-thumb-rounded-full">
          <CustomTree 
            initialSelectedId={selectedFile}
            initialExpandedItems={allExpandedPaths}
            className="w-full"
            onDirectoryToggle={handleTreeDirectoryToggle}
          >
            {renderTreeNodes(treeViewElements)}
          </CustomTree>
        </div>
      </div>
    </div>
  );
}; 