'use client';

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface DeleteConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  threadName: string;
  isDeleting: boolean;
  deleteType?: 'project' | 'conversation' | 'multiple';
}

/**
 * Confirmation dialog for deleting a project, conversation, or multiple items
 */
export function DeleteConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  threadName,
  isDeleting,
  deleteType = 'conversation',
}: DeleteConfirmationDialogProps) {
  // Reset pointer events when dialog opens
  useEffect(() => {
    if (isOpen) {
      document.body.style.pointerEvents = 'auto';
    }
  }, [isOpen]);

  const getTitle = () => {
    switch (deleteType) {
      case 'project':
        return 'Delete project';
      case 'multiple':
        return 'Delete conversations';
      default:
        return 'Delete conversation';
    }
  };

  const getDescription = () => {
    switch (deleteType) {
      case 'project':
        return (
          <>
            Are you sure you want to delete the project{' '}
            <span className="font-semibold">"{threadName}"</span>?
            <br />
            This will permanently delete the project and all its conversations.
          </>
        );
      case 'multiple':
        return (
          <>
            Are you sure you want to delete{' '}
            <span className="font-semibold">{threadName}</span>?
            <br />
            This action cannot be undone.
          </>
        );
      default:
        return (
          <>
            Are you sure you want to delete the conversation{' '}
            <span className="font-semibold">"{threadName}"</span>?
            <br />
            This action cannot be undone.
          </>
        );
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{getTitle()}</AlertDialogTitle>
          <AlertDialogDescription>
            {getDescription()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={isDeleting}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
