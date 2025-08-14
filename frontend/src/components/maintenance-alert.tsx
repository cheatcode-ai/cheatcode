'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Clock, Github, X } from 'lucide-react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/button';

interface MaintenanceAlertProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closeable?: boolean;
}

export function MaintenanceAlert({
  open,
  onOpenChange,
  closeable = true,
}: MaintenanceAlertProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={closeable ? onOpenChange : undefined}
    >
      <AlertDialogContent className="max-w-2xl w-[90vw] p-0 border-0 shadow-lg overflow-hidden rounded-2xl z-[9999]">
        <motion.div
          className="relative"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        >
          {/* Background pattern */}
          <div className="absolute inset-0 bg-accent/20 opacity-20">
            <div className="absolute inset-0 bg-grid-white/10 [mask-image:radial-gradient(white,transparent_85%)]" />
          </div>

          {closeable && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4 z-20 rounded-full hover:bg-background/80"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          )}

          <AlertDialogHeader className="gap-6 px-8 pt-10 pb-6 relative z-10">
            <motion.div
              className="flex items-center justify-center"
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
            >
              <div className="flex size-16 items-center justify-center rounded-full bg-gradient-to-t from-primary/20 to-secondary/10 backdrop-blur-md">
                <div className="flex size-12 items-center justify-center rounded-full bg-gradient-to-t from-primary to-primary/80 shadow-md">
                  <Clock className="h-6 w-6 text-white" />
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <AlertDialogTitle className="text-2xl font-bold text-center text-primary bg-clip-text">
                High Demand Notice
              </AlertDialogTitle>
            </motion.div>

            <motion.div
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <AlertDialogDescription className="text-base text-center leading-relaxed">
                Due to exceptionally high demand, our service is currently
                experiencing slower response times. We recommend returning
                tomorrow when our systems will be operating at normal capacity.
                <span className="mt-4 block font-medium text-primary">
                  Thank you for your understanding. We will notify you via email
                  once the service is fully operational again.
                </span>
              </AlertDialogDescription>
            </motion.div>
          </AlertDialogHeader>

          <AlertDialogFooter className="p-8 pt-4 border-t border-border/40 bg-background/40 backdrop-blur-sm">
            <Link
              href="https://trycheatcode.com"
              target="_blank"
              rel="noopener noreferrer"
              className="mx-auto w-full flex items-center justify-center gap-3 bg-gradient-to-tr from-primary to-primary/80 hover:opacity-90 text-white font-medium rounded-full px-8 py-3 transition-all hover:shadow-md"
            >
              <Github className="h-5 w-5 transition-transform group-hover:scale-110" />
              <span>Explore Self-Hosted Version</span>
            </Link>
          </AlertDialogFooter>
        </motion.div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
