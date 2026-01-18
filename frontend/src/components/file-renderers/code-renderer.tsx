'use client';

import CodeMirror from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { loadLanguage } from '@uiw/codemirror-extensions-langs';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

import { EditorView } from '@codemirror/view';

interface CodeRendererProps {
  content: string;
  language?: string;
  className?: string;
}

// Map of language aliases to CodeMirror language names
const languageAliases: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  html: 'html',
  css: 'css',
  json: 'json',
  md: 'markdown',
  python: 'python',
  py: 'python',
  rust: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  ruby: 'ruby',
  sh: 'shell',
  bash: 'shell',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
};

export function CodeRenderer({
  content,
  language = '',
  className,
}: CodeRendererProps) {
  // Determine the language extension to use
  const langName = languageAliases[language] || language;
  const langExtension = langName ? loadLanguage(langName as any) : null;

  // Add line wrapping extension
  const extensions = langExtension
    ? [langExtension, EditorView.lineWrapping]
    : [EditorView.lineWrapping];

  // Always use dark theme
  const theme = vscodeDark;

  return (
    <ScrollArea className={cn('w-full h-full', className)}>
      <div className="w-full h-full bg-transparent">
        <CodeMirror
          value={content}
          theme={theme}
          extensions={extensions}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            foldGutter: true,
          }}
          editable={false}
          className="text-sm w-full min-h-full"
          style={{ maxWidth: '100%' }}
          height="100%"
          onCreateEditor={(view) => {
            view.scrollDOM.style.backgroundColor = 'transparent';
            view.contentDOM.style.backgroundColor = 'transparent';
          }}
        />
        <style jsx global>{`
          .cm-editor {
            background-color: transparent !important;
          }
          .cm-gutters {
            background-color: transparent !important;
            border-right: 1px solid var(--border) !important;
          }
          .cm-activeLine, .cm-activeLineGutter {
            background-color: rgba(255, 255, 255, 0.03) !important;
          }
        `}</style>
      </div>
    </ScrollArea>
  );
}
