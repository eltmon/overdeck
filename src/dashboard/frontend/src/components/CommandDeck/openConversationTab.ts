/**
 * PAN-4466 — open or focus a conversation's agent pane in a project's deck,
 * optionally forcing a view mode. Extracted from CommandDeck's
 * `openConversationTabIn` so the Open-terminal deep link (`?view=terminal`)
 * can switch an *already open* pane's view, not just set it on creation.
 */
import { usePanesStore } from '../../lib/panesStore';
import { type ViewMode } from '../chat/ConversationPanel';

export function openConversationTab(
  projectKey: string,
  name: string,
  label: string,
  target?: {
    messageId: string;
    messageIndex: number;
    nonce: number;
    subagentId?: string;
  },
  viewMode?: ViewMode,
): void {
  const store = usePanesStore.getState();
  store.ensureHome(projectKey);
  const panes = store.panesByWorkspace[projectKey] ?? [];
  const existing = panes.find((p) => p.paneType === 'agent' && p.conversationId === name);
  const paneId = existing ? existing.paneId : store.addPane(projectKey, { paneType: 'agent', label, conversationId: name, ...(viewMode ? { viewMode } : {}) });
  if (existing && viewMode) {
    usePanesStore.getState().updatePane(projectKey, paneId, { viewMode });
  }
  store.setActivePane(projectKey, paneId);
  if (target) {
    usePanesStore.getState().updatePane(projectKey, paneId, {
      targetMessageId: target.messageId,
      targetMessageIndex: target.messageIndex,
      targetMessageNonce: target.nonce,
      targetSubagentId: target.subagentId,
    });
  }
}
