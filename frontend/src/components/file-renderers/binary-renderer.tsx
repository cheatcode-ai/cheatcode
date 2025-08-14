'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Download, File, Loader } from 'lucide-react';

interface BinaryRendererProps {
  url: string;
  fileName: string;
  className?: string;
  onDownload?: () => void;
  isDownloading?: boolean;
}

export function BinaryRenderer({
  url,
  fileName,
  className,
  onDownload,
  isDownloading = false,
}: BinaryRendererProps) {
  const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';

  // Handle download - use external handler if provided, fallback to direct URL
  const handleDownload = () => {
    if (onDownload) {
      // Use the file-viewer's more robust download handler if provided
      onDownload();
    } else if (url) {
      // Fallback to direct URL download (less robust)
      console.log(`[BINARY RENDERER] Using fallback download for ${fileName}`);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName.split('/').pop() || 'file';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      console.error('[BINARY RENDERER] No download URL or handler available');
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center p-10',
        className,
      )}
    >
      <div className="flex flex-col items-center text-center max-w-md">
        <div className="relative mb-6">
          <File className="h-24 w-24 text-muted-foreground/50" />
          <div className="absolute bottom-1 right-1 bg-background rounded-sm px-1.5 py-0.5 text-xs font-medium text-muted-foreground border">
            {fileExtension.toUpperCase()}
          </div>
        </div>

        <h3 className="text-lg font-semibold mb-2">{fileName.split('/').pop()}</h3>
        <p className="text-sm text-muted-foreground mb-6">
          This binary file cannot be previewed in the browser
        </p>

        <Button
          variant="default"
          className="min-w-[150px]"
          onClick={handleDownload}
          disabled={isDownloading}
        >
          {isDownloading ? (
            <Loader className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Download
        </Button>
      </div>
    </div>
  );
}
