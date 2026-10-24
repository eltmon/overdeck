import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { ConversationActionMenu } from '../ConversationActionMenu';
import type { Conversation } from '../ConversationList';
import type { ConversationMutations } from '../useConversationMutations';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const confirmMock = vi.fn().mockResolvedValue(true);
vi.mock('../../DialogProvider', () => ({
  useConfirm: () => confirmMock,
}));

const conversation: Conversation = {
  id: 1,
  name: 'test-conversation',
  tmuxSession: 'conv-test-conversation',
  status: 'ended',
  cwd: '/tmp',
  issueId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: false,
  title: 'Test conversation',
};

const baseMutations: ConversationMutations = {
  archive: vi.fn(),
  isArchivePending: vi.fn(() => false),
  stop: vi.fn(),
  rename: vi.fn(),
  retitle: vi.fn(),
  isRetitlePending: vi.fn(() => false),
  toggleFavorite: vi.fn(),
  move: vi.fn(),
  linkPullRequest: vi.fn(),
  unlinkPullRequest: vi.fn(),
  openForkModal: vi.fn(),
  submitFork: vi.fn(),
  forkTarget: null,
  forkTargetMode: undefined,
  forkTargetFocus: undefined,
  closeForkModal: vi.fn(),
  isForkPending: false,
};

function renderMenu(mutationOverrides: Partial<ConversationMutations>, onCloseTab = vi.fn()) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mutations: ConversationMutations = { ...baseMutations, ...mutationOverrides };
  render(
    <QueryClientProvider client={queryClient}>
      <ConversationActionMenu
        conversation={conversation}
        mutations={mutations}
        position={{ top: 0, left: 0 }}
        onClose={vi.fn()}
        onCloseTab={onCloseTab}
      />
    </QueryClientProvider>,
  );
  return { mutations, onCloseTab };
}

describe('ConversationActionMenu archive (PAN-4584)', () => {
  it('confirming Archive calls mutations.archive once and does not close the tab', async () => {
    const archive = vi.fn();
    const { onCloseTab } = renderMenu({ archive });

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));

    await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
    expect(archive).toHaveBeenCalledWith('test-conversation');
    expect(onCloseTab).not.toHaveBeenCalled();
  });

  it('renders the Archive item disabled with "Archiving…" while archive-pending', async () => {
    renderMenu({ isArchivePending: vi.fn(() => true) });

    const item = await screen.findByRole('menuitem', { name: 'Archiving…' });
    expect(item).toBeDisabled();
  });
});
