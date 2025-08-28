'use client';
import { siteConfig } from '@/lib/home';
import { ArrowRight, Github, X, AlertCircle, Square } from 'lucide-react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useState, useEffect, useRef, FormEvent } from 'react';
import { useScroll } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import {
  BillingError,
  ProjectInitiationError,
  SandboxCreationError,
  InitiationAuthError,
} from '@/lib/api';
import { useInitiateAgentMutation } from '@/hooks/react-query/agents/use-initiate-agent';
import { useThreadQuery } from '@/hooks/react-query/threads/use-threads';
import { generateAndUpdateThreadName } from '@/lib/actions/threads';

// Dialog imports removed - now using global Clerk modal system
import { BillingErrorAlert } from '@/components/billing/usage-limit-alert';
import { useBillingError } from '@/hooks/useBillingError';
import { useAccounts } from '@/hooks/use-accounts';
import { isLocalMode, config } from '@/lib/config';
import { toast } from 'sonner';
import { useModal } from '@/hooks/use-modal-store';
import { ChatInput, ChatInputHandles } from '@/components/thread/chat-input/chat-input';
import { normalizeFilenameToNFC } from '@/lib/utils/unicode';
import { Examples } from '@/components/suggestions/examples';


// BlurredDialogOverlay removed - no longer needed with global modal system

// Constant for localStorage key to ensure consistency
const PENDING_PROMPT_KEY = 'pendingAgentPrompt';

export function HeroSection() {
  const tablet = useMediaQuery('(max-width: 1024px)');
  const [mounted, setMounted] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const scrollTimeout = useRef<NodeJS.Timeout | null>(null);
  const { scrollY } = useScroll();
  const [inputValue, setInputValue] = useState('');
  const [appType, setAppType] = useState<'web' | 'mobile'>('web');
  // This is now a coding-only system - no agent selection needed
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const isLoading = !isLoaded;
  const { billingError, handleBillingError, clearBillingError } =
    useBillingError();
  const { data: accounts } = useAccounts();
  const personalAccount = accounts?.find((account) => account.personal_account);
  const { onOpen } = useModal();
  const initiateAgentMutation = useInitiateAgentMutation();
  const [initiatedThreadId, setInitiatedThreadId] = useState<string | null>(null);
  const threadQuery = useThreadQuery(initiatedThreadId || '');
  const chatInputRef = useRef<ChatInputHandles>(null);

  // No longer need auth dialog state - using global modal system

  useEffect(() => {
    setMounted(true);
  }, []);

  // Detect when scrolling is active to reduce animation complexity
  useEffect(() => {
    const unsubscribe = scrollY.on('change', () => {
      setIsScrolling(true);

      // Clear any existing timeout
      if (scrollTimeout.current) {
        clearTimeout(scrollTimeout.current);
      }

      // Set a new timeout
      scrollTimeout.current = setTimeout(() => {
        setIsScrolling(false);
      }, 300); // Wait 300ms after scroll stops
    });

    return () => {
      unsubscribe();
      if (scrollTimeout.current) {
        clearTimeout(scrollTimeout.current);
      }
    };
  }, [scrollY]);

  // Auth dialog useEffect hooks removed - now using global modal system

  useEffect(() => {
    if (threadQuery.data && initiatedThreadId) {
      const thread = threadQuery.data;
      if (thread.project_id) {
        router.push(`/projects/${thread.project_id}/thread/${initiatedThreadId}`);
      } else {
        router.push(`/agents/${initiatedThreadId}`);
      }
      setInitiatedThreadId(null);
    }
  }, [threadQuery.data, initiatedThreadId, router]);

  // Handle ChatInput submission
  const handleChatInputSubmit = async (
    message: string,
    attachments?: Array<{ name: string; path: string; }>,
    appType?: 'web' | 'mobile'
  ) => {
    if ((!message.trim() && !chatInputRef.current?.getPendingFiles().length) || isSubmitting) return;

    // If user is not logged in, save prompt and show auth modal
    if (!user && !isLoading) {
      localStorage.setItem(PENDING_PROMPT_KEY, message.trim());
      onOpen('signIn');
      return;
    }

    // User is logged in, create the agent with files
    setIsSubmitting(true);
    try {
      const files = chatInputRef.current?.getPendingFiles() || [];
      localStorage.removeItem(PENDING_PROMPT_KEY);

      const formData = new FormData();
      formData.append('prompt', message);

      // Add selected agent if one is chosen
      // No agent selection needed - system is coding-only

      // Add files if any
      files.forEach((file) => {
        const normalizedName = normalizeFilenameToNFC(file.name);
        formData.append('files', file, normalizedName);
      });

      // Validate app_type for type safety
      const validatedAppType = appType === 'mobile' ? 'mobile' : 'web';
      if (appType && appType !== 'web' && appType !== 'mobile') {
        console.warn(`Invalid app_type '${appType}', defaulting to 'web'`);
      }
      
      // model_name deprecated – backend decides the model.
      formData.append('enable_thinking', String(false));
      formData.append('reasoning_effort', 'low');
      formData.append('stream', String(true));
      formData.append('enable_context_manager', String(false));
      formData.append('app_type', validatedAppType);

      const result = await initiateAgentMutation.mutateAsync(formData);

      if (result.thread_id) {
        setInitiatedThreadId(result.thread_id);
        
        // Generate and update thread name in the background
        generateAndUpdateThreadName(result.thread_id, message)
          .then((threadName) => {
            console.log(`Thread name generated: ${threadName}`);
          })
          .catch((error) => {
            console.error('Failed to generate thread name:', error);
          });
      } else {
        throw new Error('Agent initiation did not return a thread_id.');
      }

      chatInputRef.current?.clearPendingFiles();
      setInputValue('');
    } catch (error: any) {
      if (error instanceof BillingError) {
        console.log('Billing error:', error.detail);
        onOpen("paymentRequiredDialog");
      } else if (error instanceof InitiationAuthError) {
        console.log('Authentication error:', error.detail);
        toast.error(
          'Authentication failed. Please sign in again and try creating your project.',
          { duration: 5000 }
        );
      } else if (error instanceof SandboxCreationError) {
        console.log('Sandbox creation error:', error.detail);
        toast.error(
          `Failed to create development environment${error.detail.sandboxType ? ` (${error.detail.sandboxType})` : ''}. Please try again in a moment.`,
          { duration: 5000 }
        );
      } else if (error instanceof ProjectInitiationError) {
        console.log('Project initiation error:', error.detail);
        let errorMessage = error.message;
        
        // Provide more specific messaging based on error type
        if (error.detail.errorType === 'validation') {
          errorMessage = 'Please check your inputs and try again.';
        } else if (error.detail.errorType === 'conflict') {
          errorMessage = 'A project with this configuration already exists. Please try with different settings.';
        } else if (error.detail.errorType === 'server') {
          errorMessage = 'Server error occurred. Please try again in a moment.';
        }
        
        toast.error(errorMessage, { duration: 5000 });
      } else {
        const isConnectionError =
          error instanceof TypeError &&
          error.message.includes('Failed to fetch');
        if (!isLocalMode() || isConnectionError) {
          toast.error(
            error.message || 'Failed to create project. Please try again.',
            { duration: 4000 }
          );
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section id="hero" className="w-full relative overflow-hidden">
      <div className="relative flex flex-col items-center w-full px-6">




        {/* Center content background with rounded bottom - removed to show gradient */}

        <div className="relative z-10 pt-16 max-w-3xl mx-auto h-full w-full flex flex-col gap-10 items-center justify-center">
          <div className="flex flex-col items-center justify-center gap-5 pt-8">
            <h1 className="text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-medium tracking-tighter text-balance text-center">
              what will you build today?
            </h1>
          </div>

          <div className="flex items-center w-full max-w-4xl gap-2 flex-wrap justify-center">
            <div className="w-full relative">
              <div className="relative z-10">
                <ChatInput
                  ref={chatInputRef}
                  onSubmit={handleChatInputSubmit}
                  placeholder="Describe what you need help with..."
                  loading={isSubmitting}
                  disabled={isSubmitting}
                  value={inputValue}
                  onChange={setInputValue}
                  isLoggedIn={!!user}
                  autoFocus={false}
                  appType={appType}
                  onAppTypeChange={setAppType}
                />
              </div>
              {/* Subtle glow effect */}
              <div className="absolute -bottom-4 inset-x-0 h-6 bg-secondary/20 blur-xl rounded-full -z-10 opacity-70" />
            </div>
          </div>

          {/* Example prompts */}
          <div className="w-full max-w-4xl">
            <Examples key={appType} onSelectPrompt={setInputValue} appType={appType} />
          </div>
        </div>
      </div>
      <div className="mb-16 sm:mt-52 max-w-4xl mx-auto"></div>

      {/* Auth Dialog removed - now using global Clerk modal system */}

      {/* Add Billing Error Alert here */}
      <BillingErrorAlert
        message={billingError?.message}
        currentUsage={billingError?.currentUsage}
        limit={billingError?.limit}
        accountId={personalAccount?.account_id}
        onDismiss={clearBillingError}
        isOpen={!!billingError}
      />
    </section>
  );
}
