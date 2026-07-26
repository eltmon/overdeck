import { useCallback } from 'react';
import type { Conversation } from '../CommandDeck/ConversationList';
import {
  sendConversationMessage,
  useComposerStore,
  useConversationCommandResults,
  useConversationFailed,
  type SendFailureDetails,
} from '../../lib/composerStore';

interface ComposerDeliveryStateOptions {
  conversation: Conversation;
  agentId?: string;
  serverBaseCount: number;
  onSendFailed?: () => void;
}

function openCommandUi(
  conversation: Conversation,
  action: 'handoff' | 'fork',
  focus?: string,
): void {
  window.dispatchEvent(new CustomEvent('overdeck:open-fork-modal', {
    detail: {
      conversation,
      mode: action === 'handoff' ? 'handoff' : 'summary',
      focus,
    },
  }));
}

export function useComposerDeliveryState({
  conversation,
  agentId,
  serverBaseCount,
  onSendFailed,
}: ComposerDeliveryStateOptions) {
  const failedMessages = useConversationFailed(conversation.name);
  const commandResults = useConversationCommandResults(conversation.name);
  const failSend = useComposerStore((state) => state.failSend);
  const removeFailed = useComposerStore((state) => state.removeFailed);
  const retryFailed = useComposerStore((state) => state.retryFailed);
  const replaceCommandResult = useComposerStore((state) => state.replaceCommandResult);
  const removeCommandResult = useComposerStore((state) => state.removeCommandResult);

  const handleSendFailed = useCallback((text: string, kind: 'command' | 'prompt', details?: SendFailureDetails) => {
    failSend(conversation.name, text, kind, details);
    onSendFailed?.();
  }, [conversation.name, failSend, onSendFailed]);

  const handleRetryFailed = useCallback((failedId: string, text: string) => {
    void retryFailed(
      conversation.name,
      failedId,
      text,
      serverBaseCount,
      agentId,
    ).then((result) => {
      if (result?.kind === 'ui') {
        openCommandUi(conversation, result.action, result.args.focus || undefined);
      }
    });
  }, [agentId, conversation, retryFailed, serverBaseCount]);

  const handleConfirmCommand = useCallback(async (messageId: string, typedText?: string) => {
    const message = commandResults.find(candidate => candidate.id === messageId);
    const result = message?.commandResult;
    if (!message?.commandText || result?.kind !== 'confirmation') {
      throw new Error('This command confirmation is no longer available.');
    }
    const nextResult = await sendConversationMessage(
      conversation.name,
      message.commandText,
      agentId,
      undefined,
      { nonce: result.nonce, typedText },
    );
    if (!nextResult) {
      throw new Error('The command did not return a structured result.');
    }
    if (nextResult.kind === 'ui') {
      removeCommandResult(conversation.name, messageId);
      openCommandUi(conversation, nextResult.action, nextResult.args.focus || undefined);
      return;
    }
    replaceCommandResult(conversation.name, messageId, nextResult);
  }, [agentId, commandResults, conversation, removeCommandResult, replaceCommandResult]);

  const handleDiscardFailed = useCallback((failedId: string) => {
    removeFailed(conversation.name, failedId);
  }, [conversation.name, removeFailed]);

  return {
    commandResults,
    failedMessages,
    handleConfirmCommand,
    handleDiscardFailed,
    handleRetryFailed,
    handleSendFailed,
  };
}
