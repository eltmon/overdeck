import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GitFeedCard } from '../GitFeedCard';
import type { GitSessionFeedEntry } from '../types';

function entry(overrides: Partial<GitSessionFeedEntry> = {}): GitSessionFeedEntry {
  return {
    kind: 'git',
    id: 'git-1',
    timestamp: '2026-05-23T01:00:00.000Z',
    workspaceId: null,
    issueId: 'PAN-1389',
    source: 'git-commit',
    level: 'info',
    message: 'Committed feed sidebar work',
    ...overrides,
  };
}

describe('GitFeedCard', () => {
  it('renders icon, message, issue badge, and relative timestamp', () => {
    render(<GitFeedCard entry={entry()} onSelect={vi.fn()} now={new Date('2026-05-23T01:05:00.000Z')} />);

    expect(screen.getByTestId('git-feed-icon')).toBeTruthy();
    expect(screen.getByText('Committed feed sidebar work')).toBeTruthy();
    expect(screen.getByText('PAN-1389')).toBeTruthy();

    const time = screen.getByText('5m ago') as HTMLTimeElement;
    expect(time.tagName).toBe('TIME');
    expect(time.dateTime).toBe('2026-05-23T01:00:00.000Z');
  });

  it('hides issue badge when issueId is null', () => {
    render(<GitFeedCard entry={entry({ issueId: null })} onSelect={vi.fn()} now={new Date('2026-05-23T01:05:00.000Z')} />);

    expect(screen.queryByText('PAN-1389')).toBeNull();
  });

  it('calls onSelect with the entry id when clicked', () => {
    const onSelect = vi.fn();
    render(<GitFeedCard entry={entry()} onSelect={onSelect} now={new Date('2026-05-23T01:05:00.000Z')} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onSelect).toHaveBeenCalledWith('git-1');
  });
});
