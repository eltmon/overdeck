/**
 * Per-conversation UI state — local-only, persisted to localStorage.
 *
 * Mirrors t3code's uiStateStore pattern but scoped to Panopticon's
 * conversation view.  No server sync: this is purely client chrome.
 */

import { useCallback, useState, useEffect } from 'react';

const STORAGE_KEY = 'panopticon:conversation-ui:v1';

interface PersistedState {
  hideToolCallsById: Record<string, boolean>;
}

function readPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      return { hideToolCallsById: parsed.hideToolCallsById ?? {} };
    }
  } catch {
    // ignore corrupt storage
  }
  return { hideToolCallsById: {} };
}

function writePersisted(state: PersistedState): void {
  try {
    // Only store truthy values to keep the payload small
    const pruned: Record<string, boolean> = {};
    for (const [id, hidden] of Object.entries(state.hideToolCallsById)) {
      if (hidden) pruned[id] = true;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hideToolCallsById: pruned }));
  } catch {
    // ignore quota errors
  }
}

export function useConversationUiState(conversationId: string) {
  const [state, setState] = useState<PersistedState>(readPersisted);

  // Sync when switching conversations so the hook always reflects
  // the persisted value for the *current* conversation on mount.
  useEffect(() => {
    setState(readPersisted());
  }, [conversationId]);

  const hideToolCalls = state.hideToolCallsById[conversationId] ?? false;

  const setHideToolCalls = useCallback(
    (hidden: boolean) => {
      setState((prev) => {
        const next: PersistedState = {
          hideToolCallsById: { ...prev.hideToolCallsById },
        };
        if (hidden) {
          next.hideToolCallsById[conversationId] = true;
        } else {
          delete next.hideToolCallsById[conversationId];
        }
        writePersisted(next);
        return next;
      });
    },
    [conversationId],
  );

  const toggleHideToolCalls = useCallback(() => {
    setHideToolCalls(!hideToolCalls);
  }, [hideToolCalls, setHideToolCalls]);

  return { hideToolCalls, setHideToolCalls, toggleHideToolCalls };
}
