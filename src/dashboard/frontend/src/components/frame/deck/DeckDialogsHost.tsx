/**
 * DeckDialogsHost — the deck's dialogs, mounted once by the left column
 * (PAN-5293 §6.1): the fork / handoff modal (its own conversation-mutations
 * instance), the `/handoff` listener that opens it, and the Plan dialog
 * opened through useDeckDialogs.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Conversation } from '../../CommandDeck/ConversationList';
import { ForkModal } from '../../CommandDeck/ForkModal';
import { useConversationMutations } from '../../CommandDeck/useConversationMutations';
import { PlanDialog } from '../../PlanDialog';
import { refreshDashboardState } from '../../../lib/refresh-dashboard-state';
import { useCommandDeckSelection } from '../../../lib/commandDeckSelection';
import { useDeckDialogs } from './useIssueSessionActions';
import { useOpenConversation } from './useOpenConversation';

export function DeckDialogsHost({ selectedProject }: { selectedProject: string | null }) {
  const queryClient = useQueryClient();
  const selectedConversation = useCommandDeckSelection((s) => s.selectedConversation);
  const openConversation = useOpenConversation(selectedProject);
  const mutations = useConversationMutations(selectedConversation, openConversation);
  const planDialogIssue = useDeckDialogs((s) => s.planDialogIssue);

  // Listen for `/handoff …` submitted in the chat composer — opens the fork
  // modal pre-set to handoff mode for the conversation that emitted the
  // event. Trailing text after the verb becomes the focus and pre-fills the
  // dialog's Focus textarea.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        conversation: Conversation;
        mode?: 'summary' | 'fast-summary' | 'plain' | 'handoff';
        focus?: string;
      }>).detail;
      if (!detail?.conversation) return;
      mutations.openForkModal(detail.conversation, { mode: detail.mode, focus: detail.focus });
    };
    window.addEventListener('overdeck:open-fork-modal', handler);
    return () => window.removeEventListener('overdeck:open-fork-modal', handler);
  }, [mutations]);

  return (
    <>
      {mutations.forkTarget && (
        <ForkModal
          conversation={mutations.forkTarget}
          initialMode={mutations.forkTargetMode}
          initialFocus={mutations.forkTargetFocus}
          isPending={mutations.isForkPending}
          onClose={mutations.closeForkModal}
          onConfirm={(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness, projectKey, handoffExtras) => {
            mutations.submitFork(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness, projectKey, handoffExtras);
          }}
        />
      )}
      {planDialogIssue && (
        <PlanDialog
          issue={planDialogIssue}
          isOpen={true}
          onClose={() => useDeckDialogs.getState().setPlanDialogIssue(null)}
          onComplete={async () => {
            useDeckDialogs.getState().setPlanDialogIssue(null);
            await refreshDashboardState(queryClient);
          }}
        />
      )}
    </>
  );
}
