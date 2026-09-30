/**
 * PAN-4436: a Session Vault browse copy (a conversation another machine owns)
 * shows its owner on the row.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConversationRow } from '../../CommandDeck/ConversationRow';
import type { Conversation } from '../../CommandDeck/ConversationList';
import type { ConversationMutations } from '../../CommandDeck/useConversationMutations';

vi.mock('../../DialogProvider', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

const VAULT_ID = '00000000-0000-4000-8000-000000000042';

const browseCopy: Conversation = {
  id: 42,
  name: `vault-${VAULT_ID}`,
  tmuxSession: `conv-vault-${VAULT_ID}`,
  status: 'ended',
  cwd: '/home/other/proj',
  issueId: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  endedAt: '2026-09-02T10:00:00.000Z',
  lastAttachedAt: null,
  sessionAlive: false,
  title: 'Saved on the laptop',
  origin: 'vault',
  vaultOwnerLabel: 'laptop-a',
};

const mutations: ConversationMutations = {
  archive: vi.fn(),
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

function renderRow(conv: Conversation, variant: 'flat' | 'nested') {
  render(<ConversationRow conv={conv} variant={variant} isSelected={false} onSelect={vi.fn()} mutations={mutations} />);
}

describe('ConversationRow owner badge (PAN-4436)', () => {
  it.each(['flat', 'nested'] as const)('shows "from <machine>" on a browse copy in the %s variant', (variant) => {
    renderRow(browseCopy, variant);
    const badge = screen.getByTestId('vault-owner-badge');
    expect(badge).toHaveTextContent('from laptop-a');
    expect(badge).toHaveAttribute('title', 'Read-only copy from laptop-a');
  });

  it.each(['flat', 'nested'] as const)('shows no owner badge on a local row in the %s variant', (variant) => {
    renderRow({ ...browseCopy, name: 'local', origin: 'local', vaultOwnerLabel: null }, variant);
    expect(screen.queryByTestId('vault-owner-badge')).not.toBeInTheDocument();
  });
});
