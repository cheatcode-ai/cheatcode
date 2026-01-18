import { forwardRef, useEffect, useState, useRef, useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Square, Loader2, ArrowUp, Globe, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UploadedFile } from './chat-input';
import { FileUploadHandler } from './file-upload-handler';
import { VoiceRecorder } from './voice-recorder';
import { ModelSelector } from '@/components/model-selector';
import { LiquidMetalButton } from '@/components/ui/liquid-metal-button';

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
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
}

export const MessageInput = forwardRef<HTMLTextAreaElement, MessageInputProps>(
  (
    {
      value,
      onChange,
      onSubmit,
      onTranscription,
      placeholder: _placeholder,
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

      disableAnimation = false,
      appType = 'web',
      onAppTypeChange,
      selectedModel,
      onModelChange,
    },
    ref,
  ) => {
    // Typewriter placeholder animation
    const typewriterSentences = [
      'Build a landing page',
      'Create a mobile app',
      'Fix a bug',
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



    // Ref for debounce timeout
    const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Create stable adjustHeight function
    const adjustHeight = useMemo(() => {
      return () => {
        const textarea = ref as React.RefObject<HTMLTextAreaElement>;
        if (!textarea.current) return;
        textarea.current.style.height = 'auto';
        const newHeight = Math.min(
          Math.max(textarea.current.scrollHeight, 24),
          200,
        );
        textarea.current.style.height = `${newHeight}px`;
      };
    }, [ref]);

    // Debounced version for resize events
    const debouncedAdjustHeight = useMemo(() => {
      return () => {
        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
        }
        resizeTimeoutRef.current = setTimeout(adjustHeight, 100);
      };
    }, [adjustHeight]);

    useEffect(() => {
      // Initial adjustment (immediate)
      adjustHeight();

      window.addEventListener('resize', debouncedAdjustHeight);
      return () => {
        window.removeEventListener('resize', debouncedAdjustHeight);
        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
        }
      };
    }, [value, adjustHeight, debouncedAdjustHeight]);

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

        <div className="flex flex-col gap-1 px-2 flex-1">
          <div className="flex items-start gap-2 pt-4">
             <Textarea
                ref={ref}
                value={value}
                onChange={onChange}
                onKeyDown={handleKeyDown}
                placeholder={displayPlaceholder}
                className={cn(
                  'w-full bg-transparent dark:bg-transparent border-none shadow-none focus-visible:ring-0 px-0 pb-6 pt-0 !text-[15px] min-h-[36px] max-h-[200px] overflow-y-auto resize-none font-mono text-white placeholder:text-zinc-500',
                  isDraggingOver ? 'opacity-40' : '',
                )}
                disabled={loading || (disabled && !isAgentRunning)}
                rows={1}
              />
          </div>
        </div>


        <div className="flex items-center justify-between mt-0 mb-1 px-2 relative">
          <div className="flex items-center gap-3 z-10">
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
            {/* App Type Selector */}
            {onAppTypeChange && (
              <div className="flex items-center gap-1 p-1 bg-zinc-800/50 rounded-full">
                <button
                  type="button"
                  onClick={() => onAppTypeChange('web')}
                  className={cn(
                    "p-1.5 rounded-full transition-all",
                    appType === 'web'
                      ? "bg-zinc-700 text-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  )}
                  title="Web App"
                >
                  <Globe className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onAppTypeChange('mobile')}
                  className={cn(
                    "p-1.5 rounded-full transition-all",
                    appType === 'mobile'
                      ? "bg-zinc-700 text-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  )}
                  title="Mobile App"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className='flex items-center gap-2 z-10'>
            {/* Model Selector - right aligned next to mic */}
            {onModelChange && (
              <ModelSelector
                value={selectedModel || ''}
                onChange={onModelChange}
                disabled={loading || isAgentRunning}
              />
            )}

            {isLoggedIn && <VoiceRecorder
              onTranscription={onTranscription}
              currentValue={value}
              disabled={loading || (disabled && !isAgentRunning)}
            />}

            <LiquidMetalButton
              type="submit"
              variant="circular"
              onClick={isAgentRunning && onStopAgent ? onStopAgent : onSubmit}
              className={cn(
                'h-8 w-8 flex-shrink-0 self-end rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all',
                (!value.trim() && uploadedFiles.length === 0 && !isAgentRunning) ||
                  loading ||
                  (disabled && !isAgentRunning)
                  ? 'opacity-50 cursor-not-allowed'
                  : '',
              )}
              disabled={
                (!value.trim() && uploadedFiles.length === 0 && !isAgentRunning) ||
                loading ||
                (disabled && !isAgentRunning)
              }
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isAgentRunning ? (
                <Square className="h-3.5 w-3.5 fill-current" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </LiquidMetalButton>
          </div>
        </div>

      </div>
    );
  },
);

MessageInput.displayName = 'MessageInput';