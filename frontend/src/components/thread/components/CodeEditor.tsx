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
      <div className="flex items-center justify-center h-full text-sm text-zinc-500 dark:text-zinc-300 bg-zinc-50 dark:bg-transparent">
        Select a file to view its content
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-50 dark:bg-transparent">
        <div className="flex flex-col items-center space-y-3">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          <span className="text-xs font-mono text-zinc-500 dark:text-zinc-300">Loading content...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-red-500 bg-zinc-50 dark:bg-transparent">
        Error loading file: {error.message || 'Unknown error'}
      </div>
    );
  }

  // Detect the programming language from file extension
  const language = selectedFile ? getLanguageFromExtension(selectedFile) : '';

  return (
    <div className="h-full flex flex-col bg-zinc-50 dark:bg-transparent">
      <div className="h-10 flex items-center px-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/20 backdrop-blur-sm">
        <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate tracking-wide">
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