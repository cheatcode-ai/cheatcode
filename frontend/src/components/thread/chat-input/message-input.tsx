import { forwardRef, useEffect, useState, useRef, useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Square, Loader2, ArrowUp, Globe, Smartphone, Sparkles, Send, Wand2 } from 'lucide-react';
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
  variant?: 'default' | 'home';
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
      variant = 'default',
    },
    ref,
  ) => {
    // Typewriter placeholder animation
    const typewriterSentences = [
      'Automate my client onboarding flow and send progress reports weekly',
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
      <div className="relative flex flex-col w-full h-full justify-between">

        <div className="flex flex-col gap-1 px-4 flex-1">
          <div className={cn("flex items-start gap-2", variant === 'home' ? "pt-6" : "pt-4")}>
             <Textarea
                ref={ref}
                value={value}
                onChange={onChange}
                onKeyDown={handleKeyDown}
                placeholder={displayPlaceholder}
                className={cn(
                  'w-full bg-transparent dark:bg-transparent border-none shadow-none focus-visible:ring-0 px-0 pt-0 overflow-y-auto resize-none font-mono text-white/90 placeholder:text-zinc-600',
                  variant === 'home' 
                    ? 'pb-4 !text-[16px] min-h-[48px] max-h-[200px] caret-blue-500' 
                    : 'pb-6 !text-[15px] min-h-[36px] max-h-[200px]',
                  isDraggingOver ? 'opacity-40' : '',
                )}
                disabled={loading || (disabled && !isAgentRunning)}
                rows={1}
              />
          </div>
        </div>

        {variant === 'home' ? (
          <div className="flex flex-col">
            {/* Button Row */}
            <div className="flex items-center justify-between px-4 pb-4 pt-2">
              <div className="flex items-center gap-2">
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
                    className={cn(
                      "h-10 w-10 rounded-none text-zinc-400 hover:text-white transition-all",
                      "bg-gradient-to-b from-[#333] to-[#1a1a1a]",
                      "border border-white/5",
                      "shadow-[0_1px_2px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]",
                      "hover:from-[#3a3a3a] hover:to-[#222]"
                    )}
                  />
                )}
                
                {/* App Type Selector */}
                {onAppTypeChange && (
                  <div className="flex items-center gap-1 p-1 border border-white/10 bg-black/40 backdrop-blur-sm">
                    <button
                      type="button"
                      onClick={() => onAppTypeChange('web')}
                      className={cn(
                        "h-8 px-3 flex items-center gap-2 transition-all duration-300 font-mono text-[10px] uppercase tracking-widest border border-transparent",
                        appType === 'web'
                          ? "bg-orange-500/10 text-orange-400 border-orange-500/20 shadow-[0_0_10px_rgba(249,115,22,0.1)]"
                          : "text-zinc-600 hover:text-zinc-400 hover:bg-white/5"
                      )}
                    >
                      <Globe className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Web</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onAppTypeChange('mobile')}
                      className={cn(
                        "h-8 px-3 flex items-center gap-2 transition-all duration-300 font-mono text-[10px] uppercase tracking-widest border border-transparent",
                        appType === 'mobile'
                          ? "bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-[0_0_10px_rgba(59,130,246,0.1)]"
                          : "text-zinc-600 hover:text-zinc-400 hover:bg-white/5"
                      )}
                    >
                      <Smartphone className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Mobile</span>
                    </button>
                  </div>
                )}
              </div>

              <div className='flex items-center gap-2'>
                {/* ModelSelector */}
                {onModelChange && (
                  <div className="mr-2">
                    <ModelSelector
                      value={selectedModel || ''}
                      onChange={onModelChange}
                      disabled={loading || isAgentRunning}
                      className={cn(
                        "h-10 px-3 rounded-none text-zinc-400 hover:text-white transition-all",
                        "bg-gradient-to-b from-[#333] to-[#1a1a1a]",
                        "border border-white/5",
                        "shadow-[0_1px_2px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]",
                        "hover:from-[#3a3a3a] hover:to-[#222]",
                        "font-mono text-[10px] uppercase tracking-widest"
                      )}
                    />
                  </div>
                )}

                {isLoggedIn && (
                  <VoiceRecorder
                    onTranscription={onTranscription}
                    currentValue={value}
                    disabled={loading || (disabled && !isAgentRunning)}
                    className={cn(
                      "h-10 w-10 rounded-none text-zinc-400 hover:text-white transition-all",
                      "bg-gradient-to-b from-[#333] to-[#1a1a1a]",
                      "border border-white/5",
                      "shadow-[0_1px_2px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]",
                      "hover:from-[#3a3a3a] hover:to-[#222]"
                    )}
                  />
                )}

                <LiquidMetalButton
                  type="submit"
                  variant="circular"
                  onClick={isAgentRunning && onStopAgent ? onStopAgent : onSubmit}
                  className={cn(
                    'h-10 w-10 flex-shrink-0 text-zinc-400 hover:text-white transition-all',
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
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : isAgentRunning ? (
                    <Square className="h-4 w-4 fill-current" />
                  ) : (
                    <ArrowUp className="h-5 w-5" />
                  )}
                </LiquidMetalButton>
              </div>
            </div>
            
            {/* Decorative dotted pattern footer */}
            <div className="h-10 w-full bg-[#121212] bg-[radial-gradient(rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:4px_4px] rounded-none border-t border-white/[0.05]" />
          </div>
        ) : (
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
        )}

      </div>
    );
  },
);

MessageInput.displayName = 'MessageInput';