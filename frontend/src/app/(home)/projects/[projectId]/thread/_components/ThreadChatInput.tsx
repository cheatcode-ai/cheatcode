'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChatInput } from '@/components/thread/chat-input/chat-input';
import { cn } from '@/lib/utils';
import { useThreadState } from '../_contexts/ThreadStateContext';
import { useThreadActions } from '../_contexts/ThreadActionsContext';
import { useLayout } from '../_contexts/LayoutContext';
import { useUpdateProjectMutation } from '@/hooks/react-query/threads/use-project';
import { threadStyles } from '@/lib/theme/thread-colors';

export function ThreadChatInput() {
  const { sandboxId, project, projectId } = useThreadState();
  const { sendMessage, agentState, agentGetters, stopAgent } = useThreadActions();
  const { isSidePanelOpen } = useLayout();
  const updateProjectMutation = useUpdateProjectMutation();

  const [newMessage, setNewMessage] = useState('');
  // Initialize with project's model or default to claude-sonnet-4.5
  const [selectedModel, setSelectedModel] = useState<string>(
    project?.model_name || 'claude-sonnet-4.5'
  );

  // Sync model state when project loads/changes
  useEffect(() => {
    if (project?.model_name) {
      setSelectedModel(project.model_name);
    }
  }, [project?.model_name]);

  // Use the project's app_type since it can't be changed after creation
  const projectAppType = project?.app_type || 'web';

  // Handle model change - persist to project immediately
  const handleModelChange = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    // Persist to project so it becomes the single source of truth
    if (projectId && modelId !== project?.model_name) {
      updateProjectMutation.mutate({
        projectId,
        data: { model_name: modelId }
      });
    }
  }, [projectId, project?.model_name, updateProjectMutation]);

  const handleSubmit = async (message: string, _attachments?: Array<{ name: string; path: string; }>) => {
    await sendMessage(message, { app_type: projectAppType, model_name: selectedModel });
    setNewMessage('');
  };

  return (
    <div
      className={cn(
        "absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-background via-background/90 to-transparent pt-8 pb-6 transition-all duration-200 ease-in-out",
      )}
    >
      <div className="relative w-full z-10 flex justify-center px-4 items-end gap-3 max-w-3xl mx-auto">
        <div className={cn(
          "w-full rounded-2xl shadow-2xl overflow-hidden px-4 py-2 transition-all duration-200",
          threadStyles.card
        )}>
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
            bgColor="bg-transparent"
            // Model selection - persisted to project as single source of truth
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
          />
        </div>
      </div>
    </div>
  );
}