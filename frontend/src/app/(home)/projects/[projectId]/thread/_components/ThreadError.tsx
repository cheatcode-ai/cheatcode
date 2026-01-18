import { AlertTriangle } from 'lucide-react';

interface ThreadErrorProps {
  error: string;
}

export function ThreadError({ error }: ThreadErrorProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-4 bg-[var(--background)] font-mono">
      <div className="flex w-full max-w-md flex-col items-center gap-4 border border-red-900/30 bg-[var(--background)] p-6 text-center rounded-sm">
        <div className="p-3">
          <AlertTriangle className="h-6 w-6 text-red-500/80" />
        </div>
        <h2 className="text-sm font-medium text-red-400">
          Error
        </h2>
        <div className="w-full h-px bg-red-900/20" />
        <p className="text-xs text-zinc-400 font-mono">
          {error.includes(
            'JSON object requested, multiple (or no) rows returned',
          )
            ? 'Thread not found or access denied.'
            : error
          }
        </p>
      </div>
    </div>
  );
} 