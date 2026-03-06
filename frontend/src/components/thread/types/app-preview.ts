import { type Project } from '@/lib/api';

export interface AppPreviewSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  project?: Project;
  agentStatus: string;
  // Removed unused agentName prop - custom agents no longer supported
}

export type DevServerStatus = 'stopped' | 'starting' | 'running' | 'error';
export type ViewMode = 'desktop' | 'tablet' | 'mobile';
export type MainTab = 'preview' | 'code';

export interface FileTreeItem {
  name: string;
  type: 'directory' | 'file';
  path: string;
  fullPath: string;
  children?: FileTreeItem[];
}

export interface ViewportDimensions {
  width: string;
  height: string;
}
