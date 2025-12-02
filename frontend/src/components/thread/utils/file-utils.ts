import { ViewportDimensions, ViewMode } from '../types/app-preview';

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
