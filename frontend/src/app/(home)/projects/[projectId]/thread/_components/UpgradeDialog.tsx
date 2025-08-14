import React from 'react';
import { useRouter } from 'next/navigation';
import { Brain, Clock, Crown, Sparkles, Zap } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
}

export function UpgradeDialog({ open, onOpenChange, onDismiss }: UpgradeDialogProps) {
  const router = useRouter();

  const handleUpgradeClick = () => {
    router.push('/settings/billing');
    onOpenChange(false);
    localStorage.setItem('suna_upgrade_dialog_displayed', 'true');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onPointerDownOutside={(e) => e.preventDefault()} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Crown className="h-5 w-5 mr-2 text-primary" />
            Unlock the Full Suna Experience
          </DialogTitle>
          <DialogDescription>
            You're currently using Suna's free tier with limited capabilities.
            Upgrade now to access our most powerful AI model.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Pro Benefits</h3>

          <div className="space-y-3">
            <div className="flex items-start">
              <div className="rounded-full bg-secondary/10 p-2 flex-shrink-0 mt-0.5">
                <Brain className="h-4 w-4 text-secondary" />
              </div>
              <div className="ml-3">
                <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">Advanced AI Models</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">Get access to advanced models suited for complex tasks</p>
              </div>
            </div>

            <div className="flex items-start">
              <div className="rounded-full bg-secondary/10 p-2 flex-shrink-0 mt-0.5">
                <Zap className="h-4 w-4 text-secondary" />
              </div>
              <div className="ml-3">
                <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">Faster Responses</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">Get access to faster models that breeze through your tasks</p>
              </div>
            </div>

            <div className="flex items-start">
              <div className="rounded-full bg-secondary/10 p-2 flex-shrink-0 mt-0.5">
                <Clock className="h-4 w-4 text-secondary" />
              </div>
              <div className="ml-3">
                <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">Higher Usage Limits</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">Enjoy more conversations and longer run durations</p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onDismiss}>
            Maybe Later
          </Button>
          <Button onClick={handleUpgradeClick}>
            <Sparkles className="h-4 w-4" />
            Upgrade Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 