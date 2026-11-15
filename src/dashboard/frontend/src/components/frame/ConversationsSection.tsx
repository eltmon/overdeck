/**
 * ConversationsSection — the left column's conversation list for the selected
 * project (PAN-5293 F-D13). An eyebrow header with an Active / All N switch
 * (persisted per viewer, default Active), then the shared ConversationList:
 * Active shows Needs you and Inbox; All adds Snoozed and Settled. Clicking a
 * row opens it in the deck from any route.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { ConversationList } from '../CommandDeck/ConversationList';
import { useCommandDeckSelection } from '../../lib/commandDeckSelection';
import { useOpenConversation } from './deck/useOpenConversation';
import { useProjectScope } from './deck/useProjectScope';

export const CONVERSATION_SCOPE_STORAGE_KEY = 'overdeck.ui.leftColumnConversationScope';

export type ConversationScope = 'active' | 'all';

function readScope(): ConversationScope {
  try {
    return localStorage.getItem(CONVERSATION_SCOPE_STORAGE_KEY) === 'all' ? 'all' : 'active';
  } catch {
    return 'active';
  }
}

function SegmentButton({ pressed, onClick, children, testId }: { pressed: boolean; onClick: () => void; children: ReactNode; testId: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${pressed ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
    >
      {children}
    </button>
  );
}

export function ConversationsSection({ selectedProject }: { selectedProject: string | null }) {
  const [scope, setScopeState] = useState<ConversationScope>(readScope);
  const setScope = useCallback((next: ConversationScope) => {
    setScopeState(next);
    try { localStorage.setItem(CONVERSATION_SCOPE_STORAGE_KEY, next); } catch { /* storage unavailable: the choice holds for this view */ }
  }, []);
  const { projectConvs, projectConvIdSet } = useProjectScope(selectedProject);
  const selectedConversation = useCommandDeckSelection((s) => s.selectedConversation);
  const openConversation = useOpenConversation(selectedProject);

  return (
    <section aria-label="Conversations" data-testid="left-conversations">
      <div className="flex items-center gap-2 px-2 pt-2 pb-1">
        <h2 className="eyebrow flex-1">Conversations</h2>
        <div role="group" aria-label="Conversation scope" className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          <SegmentButton testId="conversation-scope-active" pressed={scope === 'active'} onClick={() => setScope('active')}>Active</SegmentButton>
          <SegmentButton testId="conversation-scope-all" pressed={scope === 'all'} onClick={() => setScope('all')}>
            All {projectConvs.length}
          </SegmentButton>
        </div>
      </div>
      <ConversationList
        selectedConversation={selectedConversation}
        onSelectConversation={openConversation}
        includeIds={projectConvIdSet}
        scope={scope}
      />
    </section>
  );
}
