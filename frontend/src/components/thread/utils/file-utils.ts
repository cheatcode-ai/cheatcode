import { type ViewportDimensions, type ViewMode } from '../types/app-preview';

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
