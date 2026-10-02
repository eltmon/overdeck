/**
 * PAN-4466 — opening or focusing a conversation's agent pane, including the
 * terminal-view deep link: a new pane can be created directly in terminal
 * view, and an already-open pane can be switched into it without creating a
 * second pane.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { usePanesStore, selectPanesForWorkspace, selectActivePaneId } from '../../../lib/panesStore';
import { openConversationTab } from '../openConversationTab';

const WS = 'overdeck';

function panes() {
  return selectPanesForWorkspace(WS)(usePanesStore.getState());
}
function activeId() {
  return selectActivePaneId(WS)(usePanesStore.getState());
}

beforeEach(() => {
  localStorage.clear();
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} });
});

describe('openConversationTab', () => {
  it('opens a new conversation pane in terminal view', () => {
    openConversationTab(WS, 'conv-1', 'Agent', undefined, 'terminal');
    const agentPane = panes().find((p) => p.paneType === 'agent');
    expect(agentPane?.viewMode).toBe('terminal');
    expect(activeId()).toBe(agentPane?.paneId);
  });

  it('switches an existing conversation pane to terminal view', () => {
    openConversationTab(WS, 'conv-1', 'Agent');
    const firstPane = panes().find((p) => p.paneType === 'agent');
    expect(firstPane?.viewMode).toBeUndefined();

    openConversationTab(WS, 'conv-1', 'Agent', undefined, 'terminal');
    const agentPanes = panes().filter((p) => p.paneType === 'agent');
    expect(agentPanes).toHaveLength(1);
    expect(agentPanes[0]!.paneId).toBe(firstPane!.paneId);
    expect(agentPanes[0]!.viewMode).toBe('terminal');
  });

  it("leaves an existing pane's view alone when no view mode is given", () => {
    openConversationTab(WS, 'conv-1', 'Agent', undefined, 'terminal');
    const firstPane = panes().find((p) => p.paneType === 'agent');
    expect(firstPane?.viewMode).toBe('terminal');

    openConversationTab(WS, 'conv-1', 'Agent');
    const agentPanes = panes().filter((p) => p.paneType === 'agent');
    expect(agentPanes).toHaveLength(1);
    expect(agentPanes[0]!.viewMode).toBe('terminal');
  });
});
