'use client';

import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { useModal } from '@/hooks/use-modal-store';
import { cn } from '@/lib/utils';

interface BillingErrorAlertProps {
  message?: string;
  currentUsage?: number;
  limit?: number;
  accountId?: string | null;
  onDismiss: () => void;
  isOpen: boolean;
}

export function BillingErrorAlert({
  message,
  currentUsage,
  limit,
  accountId,
  onDismiss,
  isOpen,
}: BillingErrorAlertProps) {
  const router = useRouter();
  const { onOpen } = useModal();

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9999]">
      <div className="relative max-w-sm rounded-2xl ring-1 ring-white/10 border border-red-400/20 bg-gradient-to-br from-red-600/10 via-background/60 to-background/80 backdrop-blur-md shadow-[0_10px_40px_rgba(0,0,0,0.35)] p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 p-2 rounded-full bg-red-500/15 ring-1 ring-red-400/30">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-red-300 tracking-[-0.01em]">Usage limit reached</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={onDismiss}
                className="h-6 w-6 p-0 text-white/60 hover:text-white"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-sm text-white/80 mt-1 mb-3 truncate">{message || 'Payment required to continue.'}</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onDismiss}
                className="h-8 px-3 text-xs backdrop-blur bg-white/5 border-white/20 text-white/80 hover:bg-white/10"
              >
                Dismiss
              </Button>
              <Button
                size="sm"
                onClick={() => onOpen('paymentRequiredDialog')}
                className="h-8 px-3 text-xs bg-red-500/90 hover:bg-red-500 text-white"
              >
                Upgrade Plan
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
