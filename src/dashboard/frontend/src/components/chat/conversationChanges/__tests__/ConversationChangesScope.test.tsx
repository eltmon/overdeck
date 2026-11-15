import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConversationChanges } from '@overdeck/contracts';

import { installStrictFetchMock } from '../../../../test-utils/strictFetchMock';
import type { Conversation } from '../../../CommandDeck/ConversationList';
import { StageDeckProvider, type StageDeckContextValue } from '../../../Stage/StageDeckContext';
import { ConversationChangesScope, useConversationChangesContext, type ConversationChangesContextValue } from '../ConversationChangesScope';

// PAN-5295 WI-5: the panel's one changes query and its Stage dock actions.

vi.mock('../../../explorer/watch/useExplorerWatch', () => ({ useExplorerWatch: vi.fn() }));

const CHANGES: ConversationChanges = {
  conversation: 'c1',
  repoRoot: '/repo',
  rootId: null,
  branch: 'main',
  scope: 'conversation',
  uncommitted: [{ path: 'docs/a.md', status: 'M', additions: 2, deletions: 0, attribution: 'lines', turnIds: ['a1'] }],
  commits: [],
  totals: { files: 1, additions: 2, deletions: 0, commitsPushed: 0, commitsLocal: 0, uncommittedFiles: 1 },
};

const conversation = (over: Partial<Conversation> = {}): Conversation =>
  ({
    id: 1,
    name: 'c1',
    tmuxSession: 'c1',
    status: 'ended',
    cwd: '/repo',
    issueId: 'PAN-1',
    createdAt: '2026-11-15T00:00:00Z',
    endedAt: null,
    lastAttachedAt: null,
    sessionAlive: false,
    title: 'C1',
    ...over,
  }) as Conversation;

let fetchControl: ReturnType<typeof installStrictFetchMock>;
let latest: ConversationChangesContextValue | null = null;
let client: QueryClient;

function Probe() {
  latest = useConversationChangesContext();
  return <div data-testid="probe">{latest?.changes ? 'loaded' : 'empty'}</div>;
}

function renderScope(conv: Conversation, deck?: StageDeckContextValue) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const scope = (
    <ConversationChangesScope conversation={conv}>
      <Probe />
    </ConversationChangesScope>
  );
  return render(<QueryClientProvider client={client}>{deck ? <StageDeckProvider value={deck}>{scope}</StageDeckProvider> : scope}</QueryClientProvider>);
}

const requested = (): string[] => fetchControl.fetchMock.mock.calls.map(([input]) => String(input));

beforeEach(() => {
  latest = null;
  fetchControl = installStrictFetchMock(({ method, url }) => {
    if (method === 'GET' && url === '/api/conversations/c1/changes?scope=conversation') return Response.json(CHANGES);
    if (method === 'GET' && url === '/api/registered-projects') return Response.json([]);
    if (method === 'GET' && url === '/api/workspace-registry') return Response.json({ workspaces: [] });
    return undefined;
  });
});

afterEach(async () => {
  cleanup();
  await client.cancelQueries();
  client.clear();
  await fetchControl.assertNoUnexpectedRequests();
  vi.unstubAllGlobals();
});

describe('ConversationChangesScope', () => {
  it('inside a Stage gives dock actions that call openDock and openBeside with the D2-6/D2-7 inputs', async () => {
    const openDock = vi.fn();
    const openBeside = vi.fn(() => 'pane');
    renderScope(conversation(), { deckKey: 'p', openOrFocusEditorPane: vi.fn(), openOrFocusAgentPane: vi.fn(), openDock, openBeside });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('loaded'));
    const stage = latest?.stage;
    expect(latest?.rootId).toBe('issue:PAN-1');
    expect(stage).not.toBeNull();
    const target = { path: 'docs/a.md', repoPath: 'docs/a.md', repoRoot: '/repo' };
    stage!.openDiff(target, [target]);
    expect(openDock).toHaveBeenLastCalledWith({ tab: 'changes', changesScope: 'conversation', diff: target, diffList: [target] });
    stage!.showInFiles();
    expect(openDock).toHaveBeenLastCalledWith({ tab: 'files', filesFilter: 'mine' });
    stage!.reveal('docs/a.md');
    expect(openDock).toHaveBeenLastCalledWith({ tab: 'files', reveal: { rootId: 'issue:PAN-1', path: 'docs/a.md' } });
    stage!.openBeside('src/b.ts', 12);
    expect(openBeside).toHaveBeenLastCalledWith({ rootId: 'issue:PAN-1', path: 'src/b.ts', line: 12 });
  });

  it('maps absolute paths under repoRoot to repo paths and others to null', async () => {
    renderScope(conversation(), { deckKey: 'p', openOrFocusEditorPane: vi.fn(), openOrFocusAgentPane: vi.fn(), openDock: vi.fn(), openBeside: vi.fn(() => 'x') });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('loaded'));
    const stage = latest!.stage!;
    expect(stage.repoPathOfAbs('/repo/src/b.ts')).toBe('src/b.ts');
    expect(stage.repoPathOfAbs('/repository/src/b.ts')).toBeNull();
    expect(stage.repoPathOfAbs('/other/b.ts')).toBeNull();
    expect(stage.rootPathOf('docs/a.md')).toBe('docs/a.md');
  });

  it('outside a Stage has no dock actions and requests only /changes?scope=conversation', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderScope(conversation());
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('loaded'));
    expect(latest?.stage).toBeNull();
    expect(latest?.rootId).toBeNull();
    expect(requested()).toEqual(['/api/conversations/c1/changes?scope=conversation']);
    latest!.openDiffWindow('docs/a.md');
    expect(String(open.mock.calls[0][0])).toContain('diffFilePath=docs%2Fa.md');
    open.mockRestore();
  });

  it.each([
    ['a synthetic row (id < 0)', { id: -1 }],
    ['a linked conversation', { origin: 'linked' as const }],
    ['a vault copy', { origin: 'vault' as const }],
  ])('makes no /changes request for %s', async (_label, over) => {
    renderScope(conversation(over));
    await Promise.resolve();
    expect(latest?.changes).toBeNull();
    expect(requested().filter((url) => url.includes('/changes'))).toEqual([]);
  });
});
