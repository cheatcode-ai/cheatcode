import React from 'react';
import { FileTree } from './FileTree';
import { CodeEditor } from './CodeEditor';
import { FileTreeItem } from '../types/app-preview';

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
filesError,
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
      
      <div className="flex-1 bg-white dark:bg-zinc-900">
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