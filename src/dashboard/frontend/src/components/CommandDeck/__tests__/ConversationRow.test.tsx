import { render, screen } from '@testing-library/react';
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
