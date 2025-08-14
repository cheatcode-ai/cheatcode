import { FileInfo } from '@/lib/api';
import { FileTreeItem, ViewportDimensions, ViewMode } from '../types/app-preview';

export const isExcludedDirectory = (dirName: string): boolean => {
  const excludedDirs = [
    // Package managers and dependencies
    'node_modules',
    'bower_components',
    'vendor',
    
    // Build outputs and caches
    '.next',
    'dist',
    'build',
    'out',
    '.cache',
    '.parcel-cache',
    '.turbo',
    
    // IDE and editor directories
    '.vscode',
    '.idea',
    '.vs',
    '.settings',
    
    // Version control
    '.git',
    '.svn',
    '.hg',
    
    // Testing and coverage
    'coverage',
    '.nyc_output',
    '.jest',
    'jest-coverage',
    
    // Temporary and log directories
    'tmp',
    'temp',
    'logs',
    'log',
    
    // OS generated
    '.DS_Store',
    'Thumbs.db',
    
    // Other common build/cache directories
    '.gradle',
    '.mvn',
    'target',
    'bin',
    'obj',
    '.terraform',
    '__pycache__',
    '.pytest_cache'
  ];
  return excludedDirs.includes(dirName);
};

export const isImportantFile = (fileName: string): boolean => {
  const importantExtensions = ['.tsx', '.ts', '.js', '.jsx', '.css', '.json', '.md', '.html'];
  const importantFiles = ['package.json', 'next.config.ts', 'tailwind.config.ts', 'README.md'];
  
  return importantFiles.includes(fileName) || 
         importantExtensions.some(ext => fileName.endsWith(ext));
};

export const getFileLanguage = (fileName: string): string => {
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'ts': case 'tsx': return 'typescript';
    case 'js': case 'jsx': return 'javascript';
    case 'css': return 'css';
    case 'json': return 'json';
    case 'md': return 'markdown';
    case 'html': return 'html';
    default: return 'text';
  }
};

export const processDirectoryFiles = (files: FileInfo[], appType: 'web' | 'mobile' = 'web'): FileTreeItem[] => {
  const workspacePath = appType === 'mobile' ? '/workspace/cheatcode-mobile' : '/workspace/cheatcode-app';
  
  return files
    .filter(file => {
      if (file.is_dir) {
        return !isExcludedDirectory(file.name);
      } else {
        return isImportantFile(file.name);
      }
    })
    .map(file => {
      // Remove appropriate workspace prefix and handle legacy paths
      let relativePath = file.path;
      if (relativePath.startsWith(workspacePath + '/')) {
        relativePath = relativePath.substring(workspacePath.length + 1);
      } else if (relativePath === workspacePath) {
        relativePath = '';
      } else {
        // Fallback: remove any workspace prefix and legacy workspace names
        relativePath = relativePath
          .replace(/^\/workspace\//, '')
          .replace(/^(cheatcode-app|cheatcode-mobile)\//, '');
      }
      
      return {
        name: file.name,
        type: file.is_dir ? ('directory' as const) : ('file' as const),
        path: relativePath || file.name,
        fullPath: file.path,
        children: file.is_dir ? [] : undefined
      };
    })
    .sort((a, b) => {
      if (a.type === 'directory' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
};

export const getViewportDimensions = (view: ViewMode): ViewportDimensions => {
  switch (view) {
    case 'mobile':
      return { width: '375px', height: '667px' };
    case 'tablet':
      return { width: '768px', height: '1024px' };
    default:
      return { width: '100%', height: '100%' };
  }
};

export const formatFileContent = (fileContentData: any): string => {
  if (!fileContentData) return '';
  if (typeof fileContentData === 'string') return fileContentData;
  if (typeof fileContentData === 'object') return JSON.stringify(fileContentData, null, 2);
  return '[Binary file - cannot display]';
};

export const findFirstSelectableFile = (files: FileTreeItem[]): string | null => {
  const findFirstFile = (items: FileTreeItem[]): string | null => {
    for (const item of items) {
      if (item.type === 'file') {
        return item.path;
      }
      // If it's a directory with children, recursively search
      if (item.type === 'directory' && item.children) {
        const found = findFirstFile(item.children);
        if (found) return found;
      }
    }
    return null;
  };
  
  return findFirstFile(files);
}; 