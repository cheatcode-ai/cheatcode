import React from 'react';
import { Loader2 } from 'lucide-react';
import { CodeRenderer } from '@/components/file-renderers/code-renderer';
import { getLanguageFromExtension } from '@/components/file-renderers';

interface CodeEditorProps {
  selectedFile: string | null;
  content: string;
  isLoading?: boolean;
  error?: any;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ 
  selectedFile, 
  content, 
  isLoading,
  error 
}) => {
  if (!selectedFile) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500 dark:text-zinc-400">
        Select a file to view its content
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center space-y-2">
          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          <span className="text-sm text-zinc-500">Loading file content...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-red-500">
        Error loading file: {error.message || 'Unknown error'}
      </div>
    );
  }

  // Detect the programming language from file extension
  const language = selectedFile ? getLanguageFromExtension(selectedFile) : '';

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-zinc-200 dark:border-zinc-700 px-3 py-2 bg-zinc-50 dark:bg-zinc-800">
        <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
          {selectedFile}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <CodeRenderer
          content={content}
          language={language}
          className="h-full w-full"
        />
      </div>
    </div>
  );
}; 