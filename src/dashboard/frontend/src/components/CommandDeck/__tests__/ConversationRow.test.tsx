import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConversationRow } from '../ConversationRow';
import type { Conversation } from '../ConversationList';
import type { ConversationMutations } from '../useConversationMutations';

vi.mock('../../DialogProvider', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
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

const mutations: ConversationMutations = {
  archive: vi.fn(),
  stop: vi.fn(),
  rename: vi.fn(),
  retitle: vi.fn(),
  isRetitlePending: vi.fn(() => false),
  toggleFavorite: vi.fn(),
  openForkModal: vi.fn(),
  submitFork: vi.fn(),
  forkTarget: null,
  forkTargetMode: undefined,
  forkTargetFocus: undefined,
  closeForkModal: vi.fn(),
  isForkPending: false,
};

function renderRow(overrides: Partial<Conversation>) {
  render(
    <ConversationRow
      conv={{ ...conversation, ...overrides }}
      isSelected={false}
      onSelect={vi.fn()}
      mutations={mutations}
    />,
  );
}

describe('ConversationRow model metadata', () => {
  it('renders the harness when the model is absent', () => {
    renderRow({ harness: 'claude-code', model: null });

    expect(screen.getByTitle('Harness: Claude Code')).toHaveTextContent('Claude Code');
    expect(screen.queryByTitle(/^Model:/)).not.toBeInTheDocument();
  });

  it('renders both harness and model when the model is present', () => {
    renderRow({ harness: 'claude-code', model: 'k3' });

    expect(screen.getByTitle('Harness: Claude Code')).toHaveTextContent('Claude Code');
    expect(screen.getByTitle('Model: k3')).toHaveTextContent('k3');
  });
});

describe('ConversationRow stalled OpenCode turn', () => {
  it('shows a muted stalled label instead of the working spinner', () => {
    renderRow({
      harness: 'opencode',
      sessionAlive: true,
      isWorking: true,
      currentTool: 'Bash',
      stalledSince: '2026-09-20T14:23:08.000Z',
    });

    expect(screen.getByText(/waiting on agent — no activity since/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Agent stalled in test-conversation')).toBeInTheDocument();
    expect(screen.queryByLabelText('Agent working in test-conversation')).not.toBeInTheDocument();
  });
});

describe('ConversationRow handoff-fallback badge (PAN-3736)', () => {
  it('shouts in red while the conversation has shown no sign of life', () => {
    renderRow({
      forkFallbackReason: 'handoff-request-failed',
      status: 'active',
      sessionAlive: false,
      lastActivityAt: null,
    });

    const badge = screen.getByText('Fallback: handoff-request-failed');
    // CSS-module class names are hashed at build time, so match the stem.
    expect(badge.parentElement?.className).toContain('conversationForkFailed');
    expect(screen.queryByText(/^Seeded via fallback:/)).not.toBeInTheDocument();
  });

  it('downgrades to a muted note once the conversation is demonstrably alive', () => {
    renderRow({
      forkFallbackReason: 'handoff-request-failed',
      status: 'active',
      sessionAlive: true,
    });

    const note = screen.getByText('Seeded via fallback: handoff-request-failed');
    expect(note.parentElement?.className).toContain('conversationForkFallbackNote');
    expect(note.parentElement?.className).not.toContain('conversationForkFailed');
    expect(screen.queryByText(/^Fallback:/)).not.toBeInTheDocument();
  });

  it('keeps the fork-status badges in charge while the fork is unresolved', () => {
    renderRow({
      forkFallbackReason: 'handoff-request-failed',
      forkStatus: 'spawning',
      status: 'active',
      sessionAlive: true,
    });

    expect(screen.queryByText(/fallback:/i)).not.toBeInTheDocument();
    expect(screen.getByText('Spawning...')).toBeInTheDocument();
  });
});

describe('ConversationRow overflow-menu focus return (PAN-3941)', () => {
  it('returns focus to the kebab when the menu was opened from the kebab', () => {
    renderRow({});

    const kebab = screen.getByLabelText('More actions for Test conversation');
    fireEvent.click(kebab);
    const menu = screen.getByRole('menu', { name: 'Actions for Test conversation' });

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Actions for Test conversation' })).not.toBeInTheDocument();
    expect(kebab).toHaveFocus();
  });

  it('returns focus to the row when the menu was opened by right-click', () => {
    renderRow({});

    const row = screen.getByText('Test conversation').closest('button');
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row!);
    const menu = screen.getByRole('menu', { name: 'Actions for Test conversation' });

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Actions for Test conversation' })).not.toBeInTheDocument();
    expect(row).toHaveFocus();
  });
});

describe('ConversationRow pull request badge (PAN-3822)', () => {
  const link = {
    host: 'github.com',
    repository: 'eltmon/overdeck',
    number: 42,
    url: 'https://github.com/eltmon/overdeck/pull/42',
    source: 'branch' as const,
    linkedAt: '2026-09-20T00:00:00.000Z',
    dismissedAt: null,
    snapshot: {
      state: 'merged' as const,
      isDraft: false,
      title: 'Ship it',
      headBranch: 'feature/pan-42',
      baseBranch: 'main',
      reviewState: 'approved' as const,
      checks: 'green' as const,
      mergeable: null,
      additions: null,
      deletions: null,
      changedFiles: null,
      author: null,
      updatedAt: null,
      mergedAt: '2026-09-20T01:00:00.000Z',
      closedAt: null,
      syncedAt: '2026-09-20T02:00:00.000Z',
    },
  };

  it('renders the effective PR from its snapshot and opens it without selecting the row', () => {
    const onSelect = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <ConversationRow
        conv={{ ...conversation, pullRequest: link, pullRequestCount: 2 }}
        isSelected={false}
        onSelect={onSelect}
        mutations={mutations}
      />,
    );

    const badge = screen.getByRole('link', { name: /eltmon\/overdeck #42 · merged/ });
    expect(badge).toHaveAttribute('data-tone', 'success');
    expect(badge).toHaveClass('badge-bg-success');
    expect(badge).toHaveTextContent('#42');
    expect(badge).toHaveTextContent('+1');

    fireEvent.click(badge);
    expect(openSpy).toHaveBeenCalledWith('https://github.com/eltmon/overdeck/pull/42', '_blank', 'noopener,noreferrer');
    expect(onSelect).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('uses the warning tone for an open PR with changes requested', () => {
    renderRow({ pullRequest: { ...link, snapshot: { ...link.snapshot, state: 'open', reviewState: 'changes-requested' } } });
    expect(screen.getByRole('link', { name: /#42 · open/ })).toHaveAttribute('data-tone', 'warning');
  });

  it('renders no badge when the conversation has no linked PR', () => {
    renderRow({ pullRequest: null });
    expect(screen.queryByRole('link', { name: /#\d+/ })).not.toBeInTheDocument();
  });
});
