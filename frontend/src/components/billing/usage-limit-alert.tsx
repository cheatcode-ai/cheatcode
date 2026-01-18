'use client';

import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModal } from '@/hooks/use-modal-store';

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
  currentUsage: _currentUsage,
  limit: _limit,
  accountId: _accountId,
  onDismiss,
  isOpen,
}: BillingErrorAlertProps) {
  const { onOpen } = useModal();

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9999]">
      <div className="relative max-w-sm border border-red-900/30 bg-[var(--background)] shadow-2xl p-4 font-mono rounded-lg">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 p-1">
            <AlertTriangle className="h-5 w-5 text-red-500/80" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-medium text-red-400">Usage limit reached</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={onDismiss}
                className="h-6 w-6 p-0 text-red-500 hover:text-red-400 rounded-md"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-zinc-400 mt-2 mb-4 break-words font-normal">{message || 'Please upgrade your plan to continue.'}</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onDismiss}
                className="h-8 px-3 text-[10px] bg-transparent border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white rounded-md"
              >
                Dismiss
              </Button>
              <Button
                size="sm"
                onClick={() => onOpen('paymentRequiredDialog')}
                className="h-8 px-3 text-[10px] bg-zinc-100 hover:bg-white text-zinc-900 border-none rounded-md font-medium"
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
