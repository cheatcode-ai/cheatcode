import React, { forwardRef, useEffect, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Square, Loader2, ArrowUp, Monitor, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UploadedFile } from './chat-input';
import { FileUploadHandler } from './file-upload-handler';
import { VoiceRecorder } from './voice-recorder';
import { ExpandableTabs } from '@/components/ui/expandable-tabs';


import { BillingModal } from '@/components/billing/billing-modal';

interface MessageInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onTranscription: (text: string) => void;
  placeholder: string;
  loading: boolean;
  disabled: boolean;
  isAgentRunning: boolean;
  onStopAgent?: () => void;
  isDraggingOver: boolean;
  uploadedFiles: UploadedFile[];

  fileInputRef: React.RefObject<HTMLInputElement>;
  isUploading: boolean;
  sandboxId?: string;
  setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>;
  setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  setIsUploading: React.Dispatch<React.SetStateAction<boolean>>;
  hideAttachments?: boolean;
  messages?: any[]; // Add messages prop
  isLoggedIn?: boolean;

  selectedAgentId?: string;
  onAgentSelect?: (agentId: string | undefined) => void;
  disableAnimation?: boolean;
  appType?: 'web' | 'mobile';
  onAppTypeChange?: (appType: 'web' | 'mobile') => void;
}

export const MessageInput = forwardRef<HTMLTextAreaElement, MessageInputProps>(
  (
    {
      value,
      onChange,
      onSubmit,
      onTranscription,
      placeholder,
      loading,
      disabled,
      isAgentRunning,
      onStopAgent,
      isDraggingOver,
      uploadedFiles,

      fileInputRef,
      isUploading,
      sandboxId,
      setPendingFiles,
      setUploadedFiles,
      setIsUploading,
      hideAttachments = false,
      messages = [],
      isLoggedIn = true,

      selectedAgentId,
      onAgentSelect,
      disableAnimation = false,
      appType = 'web',
      onAppTypeChange,
    },
    ref,
  ) => {
    const [billingModalOpen, setBillingModalOpen] = useState(false);

    // Typewriter placeholder animation
    const typewriterSentences = [
      'build a beautiful landing page for my app',
      'build me a portfolio website with animations ',
      'build a full stack app for my startup',
    ];
    const [sentenceIndex, setSentenceIndex] = useState(0);
    const [charIndex, setCharIndex] = useState(0);
    const [isDeleting, setIsDeleting] = useState(false);
    const [displayPlaceholder, setDisplayPlaceholder] = useState(
      disableAnimation ? 'ask cheatcode to build anything ...' : typewriterSentences[0]
    );

    useEffect(() => {
      if (disableAnimation) {
        setDisplayPlaceholder('ask cheatcode to build anything ...');
        return;
      }

      const currentSentence = typewriterSentences[sentenceIndex];

      const timeout = setTimeout(() => {
        if (!isDeleting) {
          // typing characters
          const next = currentSentence.substring(0, charIndex + 1);
          setDisplayPlaceholder(next);
          setCharIndex(charIndex + 1);
          if (next.length === currentSentence.length) {
            // pause before deleting
            setTimeout(() => setIsDeleting(true), 600);
          }
        } else {
          // deleting characters
          const next = currentSentence.substring(0, charIndex - 1);
          setDisplayPlaceholder(next || ' ');
          setCharIndex(charIndex - 1);
          if (next.length === 0) {
            setIsDeleting(false);
            setSentenceIndex((sentenceIndex + 1) % typewriterSentences.length);
          }
        }
      }, isDeleting ? 30 : 70);

      return () => clearTimeout(timeout);
    }, [charIndex, isDeleting, sentenceIndex, disableAnimation]);



    useEffect(() => {
      const textarea = ref as React.RefObject<HTMLTextAreaElement>;
      if (!textarea.current) return;

      const adjustHeight = () => {
        textarea.current!.style.height = 'auto';
        const newHeight = Math.min(
          Math.max(textarea.current!.scrollHeight, 24),
          200,
        );
        textarea.current!.style.height = `${newHeight}px`;
      };

      adjustHeight();

      // Call it twice to ensure proper height calculation
      adjustHeight();

      window.addEventListener('resize', adjustHeight);
      return () => window.removeEventListener('resize', adjustHeight);
    }, [value, ref]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (
          (value.trim() || uploadedFiles.length > 0) &&
          !loading &&
          (!disabled || isAgentRunning)
        ) {
          onSubmit(e as unknown as React.FormEvent);
        }
      }
    };



    return (
      <div className="relative flex flex-col w-full h-full gap-2 justify-between">

        <div className="flex flex-col gap-1 px-2">
          <Textarea
            ref={ref}
            value={value}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            placeholder={displayPlaceholder}
            className={cn(
              'w-full bg-transparent dark:bg-transparent border-none shadow-none focus-visible:ring-0 px-0.5 pb-6 pt-4 !text-[15px] min-h-[36px] max-h-[200px] overflow-y-auto resize-none',
              isDraggingOver ? 'opacity-40' : '',
            )}
            disabled={loading || (disabled && !isAgentRunning)}
            rows={1}
          />
        </div>


        <div className="flex items-center justify-between mt-0 mb-1 px-2">
          <div className="flex items-center gap-3">
            {!hideAttachments && (
              <FileUploadHandler
                ref={fileInputRef}
                loading={loading}
                disabled={disabled}
                isAgentRunning={isAgentRunning}
                isUploading={isUploading}
                sandboxId={sandboxId}
                setPendingFiles={setPendingFiles}
                setUploadedFiles={setUploadedFiles}
                setIsUploading={setIsUploading}
                messages={messages}
                isLoggedIn={isLoggedIn}
                appType={appType}
              />
            )}

            {/* Only show app type toggle when creating new projects (onAppTypeChange is provided) */}
            {onAppTypeChange && (
              <ExpandableTabs
                tabs={[
                  { title: "building for web", icon: Monitor, iconColor: "text-orange-500" },
                  { type: "separator" },
                  { title: "building for mobile", icon: Smartphone, iconColor: "text-green-500" }
                ]}
                onChange={(index) => {
                  if (index === 0) {
                    onAppTypeChange('web');
                  } else if (index === 2) {
                    onAppTypeChange('mobile');
                  }
                }}
              />
            )}

          </div>

          <div className='flex items-center gap-2'>

            {/* Billing Modal */}
            <BillingModal
              open={billingModalOpen}
              onOpenChange={setBillingModalOpen}
              returnUrl={typeof window !== 'undefined' ? window.location.href : '/'}
            />

            {isLoggedIn && <VoiceRecorder
              onTranscription={onTranscription}
              disabled={loading || (disabled && !isAgentRunning)}
            />}

            <Button
              type="submit"
              onClick={isAgentRunning && onStopAgent ? onStopAgent : onSubmit}
              size="sm"
              className={cn(
                'w-8 h-8 flex-shrink-0 self-end rounded-xl',
                (!value.trim() && uploadedFiles.length === 0 && !isAgentRunning) ||
                  loading ||
                  (disabled && !isAgentRunning)
                  ? 'opacity-50'
                  : '',
              )}
              disabled={
                (!value.trim() && uploadedFiles.length === 0 && !isAgentRunning) ||
                loading ||
                (disabled && !isAgentRunning)
              }
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isAgentRunning ? (
                <div className="min-h-[14px] min-w-[14px] w-[14px] h-[14px] rounded-sm bg-current" />
              ) : (
                <ArrowUp className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>

      </div>
    );
  },
);

MessageInput.displayName = 'MessageInput';