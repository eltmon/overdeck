import { toast } from 'sonner';
import type { ComposerCommandResult } from '@overdeck/contracts';
import {
  consumeCancelledSend,
  MessageSendError,
  runCancellableSend,
  sendConversationMessage,
  sendFailureDetails,
  useComposerStore,
  type SendFailureDetails,
} from '../../lib/composerStore';

export interface QueuedPrompt {
  conversationName: string;
  message: string;
  clientMessageId: string;
  agentId?: string;
  deliverAs?: 'steer' | 'follow_up';
  onAcknowledged?: (text: string, clientMessageId?: string) => void;
  onFailed?: (text: string, kind: 'command' | 'prompt', details?: SendFailureDetails) => void;
  /** The server asked the dashboard to open a dialog (handoff/fork) instead. */
  onOpenUi: (action: Extract<ComposerCommandResult, { kind: 'ui' }>['action'], focus?: string) => void;
}

/** Runs inside the conversation's send queue (PAN-5184). Never touches the editor. */
export async function deliverQueuedPrompt(prompt: QueuedPrompt): Promise<void> {
  const { conversationName: name, message, clientMessageId } = prompt;
  // PAN-5237: cancelled while it waited in the queue; cancelSend already settled the bubble.
  if (consumeCancelledSend(clientMessageId)) return;
  // FR-7: never overtake an earlier message held behind a permission prompt.
  if (useComposerStore.getState().holdBehindHeld(name, clientMessageId)) return;
  try {
    // FR-9: the runner restarts the send clock, so queue time does not count toward TURN_STALL_MS.
    const outcome = await runCancellableSend(name, clientMessageId, prompt.agentId ? 'agent' : 'conversation', () =>
      sendConversationMessage(name, message, prompt.agentId, prompt.deliverAs, undefined, {
        clientMessageId,
        // PAN-4292 NFR-4: never let a steer degrade to a queued message silently.
        onSteerDegraded: (reason) => toast.warning(`Sent without interrupting: ${reason}`),
      }));
    if (outcome.cancelled) return;
    const result = outcome.result;
    if (result?.kind === 'ui') prompt.onOpenUi(result.action, result.args.focus || undefined);
    else if (result) useComposerStore.getState().addCommandResult(name, message, result);
    else prompt.onAcknowledged?.(message, clientMessageId);
  } catch (err) {
    // PAN-4278: a permission prompt is up, so the server pasted nothing.
    if (err instanceof MessageSendError && err.code === 'permission-pending') {
      useComposerStore.getState().hold(name, clientMessageId);
      return;
    }
    console.error('[ComposerFooter] Failed to send:', err);
    toast.error(err instanceof Error ? err.message : 'Failed to send message');
    prompt.onFailed?.(message, 'prompt', { ...sendFailureDetails(err), clientMessageId, deliverAs: prompt.deliverAs });
  }
}
