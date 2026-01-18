import { useRef, useState, useCallback, useEffect } from 'react';
import { UnifiedMessage } from '../_types';

interface UseMessageScrollReturn {
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  latestMessageRef: React.RefObject<HTMLDivElement | null>;
  showScrollButton: boolean;
  userHasScrolled: boolean;
  setUserHasScrolled: (scrolled: boolean) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

export function useMessageScroll(
  messages: UnifiedMessage[],
  _streamingTextContent: string,
  _streamingToolCall: unknown,
  isAgentRunning: boolean
): UseMessageScrollReturn {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [userHasScrolled, setUserHasScrolled] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  // Auto-scroll on new messages or agent activity
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    const isNewUserMessage = lastMsg?.type === 'user';
    if ((isNewUserMessage || isAgentRunning) && !userHasScrolled) {
      scrollToBottom('smooth');
    }
  }, [messages, isAgentRunning, userHasScrolled, scrollToBottom]);

  // Intersection observer for scroll button visibility
  useEffect(() => {
    if (!latestMessageRef.current || messages.length === 0) return;

    const observer = new IntersectionObserver(
      ([entry]) => setShowScrollButton(!entry?.isIntersecting),
      { root: messagesContainerRef.current, threshold: 0.1 },
    );

    observer.observe(latestMessageRef.current);
    return () => observer.disconnect();
  }, [messages, _streamingTextContent, _streamingToolCall]);

  return {
    messagesEndRef,
    messagesContainerRef,
    latestMessageRef,
    showScrollButton,
    userHasScrolled,
    setUserHasScrolled,
    scrollToBottom,
  };
}