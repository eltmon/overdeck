/** PAN-5291 D1-10/11: the conversation status line in words. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
  abbreviateHome,
  commitsNotPushedLabel,
  commitsPushedLabel,
  ConversationStatusLine,
  filesNotCommittedLabel,
} from '../ConversationStatusLine';
import type { HeaderTotals } from '../headerChanges';
import type { Conversation } from '../../../CommandDeck/ConversationList';

const CONVERSATION = {
  id: 1,
  name: 'conv-1',
  tmuxSession: 'conv-1',
  status: 'active',
  cwd: '/home/eltmon/Projects/dfai',
  branch: 'main',
  issueId: null,
  createdAt: '2026-11-15T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
  totalCost: 43.06,
  sessionFile: '/x/abc12345-0000.jsonl',
} as unknown as Conversation;

const STATUS = { color: 'var(--state-live)', label: 'Working', hollow: false };
const TOTALS: HeaderTotals = { files: 3, additions: 86, deletions: 1, commitsPushed: 2, commitsLocal: 1, uncommittedFiles: 1 };

afterEach(cleanup);

describe('status line helpers', () => {
  it('abbreviates the home directory and leaves other paths alone', () => {
    expect(abbreviateHome('/home/eltmon/Projects/dfai')).toBe('~/Projects/dfai');
    expect(abbreviateHome('/Users/a')).toBe('~');
    expect(abbreviateHome('/root/x')).toBe('~/x');
    expect(abbreviateHome('/srv/app')).toBe('/srv/app');
    expect(abbreviateHome('/homes/x')).toBe('/homes/x');
  });

  it('uses singular and plural forms', () => {
    expect(commitsPushedLabel(1)).toBe('1 commit pushed');
    expect(commitsPushedLabel(2)).toBe('2 commits pushed');
    expect(commitsNotPushedLabel(1)).toBe('1 commit not pushed');
    expect(commitsNotPushedLabel(2)).toBe('2 commits not pushed');
    expect(filesNotCommittedLabel(1)).toBe('1 file not committed');
    expect(filesNotCommittedLabel(2)).toBe('2 files not committed');
  });
});

describe('ConversationStatusLine', () => {
  it('renders the parts in order and opens the matching dock tab from each', () => {
    const openDock = vi.fn();
    const { container } = render(
      <ConversationStatusLine conversation={CONVERSATION} status={STATUS} native={false} changes={{ totals: TOTALS, openDock }} />,
    );

    const text = container.textContent ?? '';
    const order = ['Working', '~/Projects/dfai', 'main', '2 commits pushed', '1 commit not pushed', '1 file not committed', '$43.06'];
    const positions = order.map((part) => text.indexOf(part));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).not.toContain('abc12345');

    fireEvent.click(screen.getByRole('button', { name: '~/Projects/dfai' }));
    expect(openDock).toHaveBeenLastCalledWith({ tab: 'files' });
    fireEvent.click(screen.getByRole('button', { name: '2 commits pushed' }));
    expect(openDock).toHaveBeenLastCalledWith({ tab: 'changes', changesScope: 'conversation' });
    fireEvent.click(screen.getByRole('button', { name: '1 commit not pushed' }));
    expect(openDock).toHaveBeenLastCalledWith({ tab: 'changes', changesScope: 'conversation' });
    const uncommitted = screen.getByRole('button', { name: '1 file not committed' });
    expect(uncommitted).toHaveClass('text-state-needs-you');
    fireEvent.click(uncommitted);
    expect(openDock).toHaveBeenLastCalledWith({ tab: 'changes', changesScope: 'uncommitted' });
    expect(screen.getByText('$43.06')).toHaveClass('text-signal-cost-foreground');
  });

  it('renders no part for a zero count', () => {
    render(
      <ConversationStatusLine
        conversation={CONVERSATION}
        status={STATUS}
        native={false}
        changes={{ totals: { ...TOTALS, commitsPushed: 0, commitsLocal: 0, uncommittedFiles: 0 }, openDock: vi.fn() }}
      />,
    );
    expect(screen.queryByText(/commit/)).toBeNull();
    expect(screen.getByRole('button', { name: '~/Projects/dfai' })).toBeInTheDocument();
  });

  it('renders the folder as plain text and no change parts outside a Stage', () => {
    render(<ConversationStatusLine conversation={CONVERSATION} status={STATUS} native={false} changes={null} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('~/Projects/dfai')).toHaveAttribute('title', '/home/eltmon/Projects/dfai');
    expect(screen.queryByText(/commit/)).toBeNull();
  });

  it('shows the branch in mono with the Local/Worktree word in its tooltip', () => {
    render(<ConversationStatusLine conversation={{ ...CONVERSATION, isWorktree: true } as Conversation} status={STATUS} native={false} />);
    const branch = screen.getByText('main').parentElement!;
    expect(branch).toHaveClass('font-mono');
    expect(branch).toHaveAttribute('title', 'Worktree · /home/eltmon/Projects/dfai');
    expect(screen.queryByText('Worktree')).toBeNull();
  });
});
