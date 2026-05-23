import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActivityFeedCard } from '../ActivityFeedCard';
import type { ActivitySessionFeedEntry } from '../types';

function entry(overrides: Partial<ActivitySessionFeedEntry> = {}): ActivitySessionFeedEntry {
  return {
    kind: 'activity',
    id: 'obs-1',
    timestamp: '2026-05-23T01:00:00.000Z',
    workspaceId: 'workspace-a',
    issueId: 'PAN-1389',
    headline: 'Building selector',
    summary: 'The agent is building the selector.',
    ...overrides,
  };
}

describe('ActivityFeedCard', () => {
  it('renders headline and workspace/issue subtext', () => {
    render(<ActivityFeedCard entry={entry()} onSelect={vi.fn()} now={new Date('2026-05-23T01:05:00.000Z')} />);

    expect(screen.getByText('Building selector')).toBeTruthy();
    expect(screen.getByText('workspace-a · PAN-1389')).toBeTruthy();
  });

  it('shows relative timestamp in a time element', () => {
    render(<ActivityFeedCard entry={entry()} onSelect={vi.fn()} now={new Date('2026-05-23T01:05:00.000Z')} />);

    const time = screen.getByText('5m ago') as HTMLTimeElement;
    expect(time.tagName).toBe('TIME');
    expect(time.dateTime).toBe('2026-05-23T01:00:00.000Z');
  });

  it('calls onSelect with the entry id when clicked', () => {
    const onSelect = vi.fn();
    render(<ActivityFeedCard entry={entry()} onSelect={onSelect} now={new Date('2026-05-23T01:05:00.000Z')} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onSelect).toHaveBeenCalledWith('obs-1');
  });
});
