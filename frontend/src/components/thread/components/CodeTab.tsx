import dynamic from 'next/dynamic';
import { FileTree } from './FileTree';
import { FileTreeItem } from '../types/app-preview';

// Dynamic import for CodeEditor - heavy component with syntax highlighting
const CodeEditor = dynamic(
  () => import('./CodeEditor').then(mod => ({ default: mod.CodeEditor })),
  {
    loading: () => (
      <div className="h-full flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="animate-pulse text-zinc-400 text-sm">Loading editor...</div>
      </div>
    ),
    ssr: false
  }
);

interface CodeTabProps {
files: FileTreeItem[];
selectedFile: string | null;
content: string;
isLoadingFiles: boolean;
isLoadingContent: boolean;
filesError: any;
contentError: any;
onFileSelect: (filePath: string) => void;
onDirectoryToggle: (directoryPath: string) => void;
expandedDirectories: Set<string>;
loadingDirectories?: Set<string>;
appType?: string;
}

export const CodeTab: React.FC<CodeTabProps> = ({
files,
selectedFile,
content,
isLoadingFiles,
isLoadingContent,
filesError: _filesError,
contentError,
onFileSelect,
onDirectoryToggle,
expandedDirectories,
loadingDirectories = new Set(),
appType
}) => {
  return (
    <div className="h-full flex">
      <FileTree
        files={files}
        selectedFile={selectedFile}
        onFileSelect={onFileSelect}
        onDirectoryToggle={onDirectoryToggle}
        expandedDirectories={expandedDirectories}
        loadingDirectories={loadingDirectories}
        isLoading={isLoadingFiles}
        appType={appType}
      />
      
      <div className="flex-1 bg-zinc-50 dark:bg-zinc-950">
        <CodeEditor
          selectedFile={selectedFile}
          content={content}
          isLoading={isLoadingContent}
          error={contentError}
        />
      </div>
    </div>
  );
}; 