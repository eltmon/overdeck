/** PAN-5465 WI-9: the Add skills… item in the conversation tab menu and the conversation header menu. */
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { ConversationHeaderMenu } from '../../chat/header/ConversationHeaderMenu';
import { ConversationActionMenu } from '../ConversationActionMenu';
import type { Conversation } from '../ConversationList';
import type { ConversationMutations } from '../useConversationMutations';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../DialogProvider', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));

function conversationWith(harness: Conversation['harness']): Conversation {
  return {
    id: 1,
    name: 'test-conversation',
    tmuxSession: 'conv-test-conversation',
    status: 'active',
    cwd: '/tmp',
    issueId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    endedAt: null,
    lastAttachedAt: null,
    sessionAlive: true,
    title: 'Test conversation',
    claudeSessionId: 'session-1',
    harness,
  };
}

function mutationsWith(overrides: Partial<ConversationMutations> = {}): ConversationMutations {
  return {
    archive: vi.fn(),
    isArchivePending: vi.fn(() => false),
    stop: vi.fn(),
    isStopPending: vi.fn(() => false),
    rename: vi.fn(),
    retitle: vi.fn(),
    isRetitlePending: vi.fn(() => false),
    toggleFavorite: vi.fn(),
    move: vi.fn(),
    linkPullRequest: vi.fn(),
    unlinkPullRequest: vi.fn(),
    triage: vi.fn(),
    undoLastTriage: vi.fn(() => false),
    setAutoSettleOverride: vi.fn(),
    openForkModal: vi.fn(),
    submitFork: vi.fn(),
    forkTarget: null,
    forkTargetMode: undefined,
    forkTargetFocus: undefined,
    closeForkModal: vi.fn(),
    isForkPending: false,
    addSkillsTarget: null,
    openAddSkillsModal: vi.fn(),
    closeAddSkillsModal: vi.fn(),
    ...overrides,
  };
}

function withClient(node: React.ReactNode) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>;
}

function renderTabMenu(harness: Conversation['harness']) {
  const mutations = mutationsWith();
  const onClose = vi.fn();
  const conversation = conversationWith(harness);
  render(withClient(
    <ConversationActionMenu conversation={conversation} mutations={mutations} position={{ top: 0, left: 0 }} onClose={onClose} />,
  ));
  return { mutations, onClose, conversation };
}

function renderHeaderMenu(harness: Conversation['harness']) {
  const mutations = mutationsWith();
  const onClose = vi.fn();
  const conversation = conversationWith(harness);
  render(withClient(
    <ConversationHeaderMenu
      open
      conversation={conversation}
      viewMode="conversation"
      convMutations={mutations}
      archivePending={false}
      onClose={onClose}
      triggerRef={createRef<HTMLButtonElement>()}
      native={false}
      aboutOpen={false}
      onToggleAbout={vi.fn()}
      hideToolCalls={false}
      onToggleHideToolCalls={vi.fn()}
      subagentCount={0}
      onToggleSubagents={vi.fn()}
      retitlePending={false}
      onRetitle={vi.fn()}
    />,
  ));
  return { mutations, onClose, conversation };
}

describe('ConversationActionMenu Add skills… (PAN-5465)', () => {
  it('renders for a Claude Code conversation and opens the dialog for it', async () => {
    const { mutations, onClose, conversation } = renderTabMenu('claude-code');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add skills…' }));
    expect(mutations.openAddSkillsModal).toHaveBeenCalledWith(conversation);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders for a conversation without a recorded harness', async () => {
    renderTabMenu(null);
    expect(await screen.findByRole('menuitem', { name: 'Add skills…' })).toBeTruthy();
  });

  it('is absent for a Pi conversation', async () => {
    renderTabMenu('pi');
    await screen.findByRole('menuitem', { name: 'Export transcript' });
    expect(screen.queryByRole('menuitem', { name: 'Add skills…' })).toBeNull();
  });
});

describe('ConversationHeaderMenu Add skills… (PAN-5465)', () => {
  it.each(['claude-code', 'codex'] as const)('renders for a %s conversation and opens the dialog', async (harness) => {
    const { mutations, onClose, conversation } = renderHeaderMenu(harness);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add skills…' }));
    expect(mutations.openAddSkillsModal).toHaveBeenCalledWith(conversation);
    expect(onClose).toHaveBeenCalled();
  });

  it('is absent for a Pi conversation', async () => {
    renderHeaderMenu('pi');
    await screen.findByRole('menuitem', { name: 'Export transcript' });
    expect(screen.queryByRole('menuitem', { name: 'Add skills…' })).toBeNull();
  });
});
