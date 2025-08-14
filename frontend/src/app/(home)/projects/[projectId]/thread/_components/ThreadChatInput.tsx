import React, { useState } from 'react';
import { ChatInput } from '@/components/thread/chat-input/chat-input';
import { cn } from '@/lib/utils';
import { useThreadState } from '../_contexts/ThreadStateContext';
import { useThreadActions } from '../_contexts/ThreadActionsContext';
import { useLayout } from '../_contexts/LayoutContext';

export function ThreadChatInput() {
  const { sandboxId, project } = useThreadState();
  const { sendMessage, agentState, agentGetters, stopAgent } = useThreadActions();
  const { isSidePanelOpen, isMobile } = useLayout();
  
  const [newMessage, setNewMessage] = useState('');
  
  // Use the project's app_type since it can't be changed after creation
  const projectAppType = project?.app_type || 'web';

  const handleSubmit = async (message: string, attachments?: Array<{ name: string; path: string; }>) => {
    await sendMessage(message, { app_type: projectAppType });
    setNewMessage('');
  };

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 z-10 bg-gradient-to-t from-background via-background/90 to-transparent px-4 pt-8 transition-all duration-200 ease-in-out",
        !isMobile && (isSidePanelOpen ? 'right-[60vw]' : 'right-0'),
        isMobile && (isSidePanelOpen ? 'right-2' : 'right-0')
      )}
    >
      <div
        className={cn(
          !isMobile && 'pl-0',
          isMobile ? 'px-0' : 'px-4',
          isSidePanelOpen && !isMobile ? 'w-full' : 'mx-auto w-full max-w-3xl'
        )}
      >
        <ChatInput
          value={newMessage}
          onChange={setNewMessage}
          onSubmit={handleSubmit}
          placeholder="Describe what you need help with..."
          loading={agentState.isSending}
          disabled={agentState.isSending || agentGetters.isActive}
          isAgentRunning={agentGetters.isActive}
          onStopAgent={stopAgent}
          autoFocus={false}
          sandboxId={sandboxId || undefined}
          messages={[]}
          isLoggedIn={true}
          isSidePanelOpen={isSidePanelOpen}
          disableAnimation={true}
          bgColor="bg-muted"
          // No app type toggle - use project's fixed app_type
        />
      </div>
    </div>
  );
}