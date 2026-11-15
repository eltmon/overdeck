/**
 * useCreateConversation — create a conversation and open it in the deck
 * (PAN-5293 WI-5, moved from CommandDeck's createConversationForProject).
 *
 * `create` POSTs `/api/conversations` with the newConversationDefaults model,
 * harness and effort, selects the conversation, opens its pane in the deck
 * (`projectKey`, else `deckKey`, else the No-project bucket), calls
 * `openInDeck` with its id and refreshes the conversation list. It resolves
 * to the new name, or to the error after toasting it.
 */

import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { MODEL_EFFORT_SUPPORT } from '../../chat/ModelPicker';
import { pickerEffortLevels, type Harness } from '../../shared/ModelPicker';
import type { ViewMode } from '../../chat/ConversationPanel';
import type { Conversation } from '../../CommandDeck/ConversationList';
import { openConversationTab } from '../../CommandDeck/openConversationTab';
import { NO_PROJECT_KEY } from '../../CommandDeck/projectsData';
import { useCommandDeckSelection } from '../../../lib/commandDeckSelection';
import { useDeckNavigation } from './deckNavigation';
import { useNewConversationDefaults } from './newConversationDefaults';

export type CreateConversationResult = { name: string } | { error: string };

/** The harness a launcher agent id runs on. */
export function harnessForAgent(agentId: string): Harness {
  return agentId === 'codex' ? 'codex' : agentId === 'pi' ? 'pi' : agentId === 'ohmypi' ? 'ohmypi' : 'claude-code';
}

export function useCreateConversation(deckKey: string | null, onCreated?: (conv: Conversation) => void) {
  const queryClient = useQueryClient();
  const { openInDeck } = useDeckNavigation();

  const create = useCallback(
    async (projectKey?: string, harnessOverride?: Harness, message?: string, viewMode?: ViewMode): Promise<CreateConversationResult> => {
      try {
        const { model, harness: defaultHarness, effort } = useNewConversationDefaults.getState();
        const harness = harnessOverride ?? defaultHarness;
        const payload: Record<string, unknown> = { model, harness };
        const effortLevels = pickerEffortLevels(model) ?? MODEL_EFFORT_SUPPORT[model as keyof typeof MODEL_EFFORT_SUPPORT];
        if (effortLevels?.length !== 0) payload.effort = effort;
        if (projectKey) payload.projectKey = projectKey;
        const trimmedMessage = message?.trim();
        if (trimmedMessage) payload.message = trimmedMessage;
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Request failed' }));
          throw new Error((err as { error?: string }).error || 'Failed to create conversation');
        }
        const conv = await res.json() as Conversation;
        useCommandDeckSelection.getState().setSelectedConversation(conv.name);
        const targetDeck = projectKey ?? deckKey ?? NO_PROJECT_KEY;
        openConversationTab(targetDeck, conv.name, conv.title ?? 'Agent', undefined, viewMode);
        openInDeck({ projectKey: targetDeck, conversationRouteKey: String(conv.id) });
        onCreated?.(conv);
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        return { name: conv.name };
      } catch (err) {
        console.error('[CommandDeck] Failed to create conversation:', err);
        toast.error(err instanceof Error ? err.message : 'Failed to create conversation');
        return { error: err instanceof Error ? err.message : 'Failed to create conversation' };
      }
    },
    [deckKey, onCreated, openInDeck, queryClient],
  );

  // Launch-component creator (ProjectHome / IssueOverview): a conversation in
  // the deck's project for the chosen agent. The No-project bucket creates
  // unscoped conversations (no projectKey).
  const createForAgent = useCallback(
    (agentId: string, message?: string, viewMode?: ViewMode): Promise<CreateConversationResult> => {
      const projectKey = deckKey && deckKey !== NO_PROJECT_KEY ? deckKey : undefined;
      return create(projectKey, harnessForAgent(agentId), message, viewMode);
    },
    [create, deckKey],
  );

  return useMemo(() => ({ create, createForAgent }), [create, createForAgent]);
}
