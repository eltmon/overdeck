import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActivityFeedCard, activityEntryClipboardText } from '../ActivityFeedCard';
import type { ActivitySessionFeedEntry } from '../types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

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

/** A system event: no link and no issue, so nothing to navigate to. */
function systemEntry(overrides: Partial<ActivitySessionFeedEntry> = {}): ActivitySessionFeedEntry {
  return entry({
    issueId: undefined,
    link: undefined,
    workspaceId: undefined,
    headline: 'State migration for auricle is blocked',
    summary: 'Project auricle is a polyrepo whose state path is not itself a git repository.',
    ...overrides,
  });
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

    fireEvent.click(screen.getByTestId('activity-feed-card'));

    expect(onSelect).toHaveBeenCalledWith('obs-1');
  });

  // A card with no link and no issueId has no destination — navigateToFeedEntry
  // falls through to a bare return. Rendering it as a button advertised a click
  // that silently did nothing.
  it('does not advertise a click when the entry has no destination', () => {
    const onSelect = vi.fn();
    render(<ActivityFeedCard entry={systemEntry()} onSelect={onSelect} now={new Date('2026-05-23T01:05:00.000Z')} />);

    expect(screen.getByTestId('activity-feed-card').tagName).not.toBe('BUTTON');
    fireEvent.click(screen.getByTestId('activity-feed-card'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('still navigates when the entry has a link but no issueId', () => {
    const onSelect = vi.fn();
    const linked = systemEntry({ link: '/command-deck?tab=activity' });
    render(<ActivityFeedCard entry={linked} onSelect={onSelect} now={new Date('2026-05-23T01:05:00.000Z')} />);

    fireEvent.click(screen.getByTestId('activity-feed-card'));

    expect(onSelect).toHaveBeenCalledWith('obs-1');
  });

  it('copies the notification contents to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<ActivityFeedCard entry={entry()} onSelect={vi.fn()} now={new Date('2026-05-23T01:05:00.000Z')} />);
    fireEvent.click(screen.getByTestId('activity-feed-copy'));

    expect(writeText).toHaveBeenCalledWith(
      'Building selector\n\nThe agent is building the selector.\n\nworkspace-a · PAN-1389 · 2026-05-23T01:00:00.000Z',
    );
  });

  it('copying does not trigger navigation', () => {
    const onSelect = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });

    render(<ActivityFeedCard entry={entry()} onSelect={onSelect} now={new Date('2026-05-23T01:05:00.000Z')} />);
    fireEvent.click(screen.getByTestId('activity-feed-copy'));

    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('activityEntryClipboardText', () => {
  it('omits the summary when it only repeats the headline', () => {
    expect(activityEntryClipboardText(entry({ summary: 'Building selector' })))
      .toBe('Building selector\n\nworkspace-a · PAN-1389 · 2026-05-23T01:00:00.000Z');
  });

  it('keeps the full untruncated body for a long system message', () => {
    const long = 'Project auricle is a polyrepo whose state path (/home/eltmon/Projects/auricle) is not itself a git repository, so the top-level state-migration cleanliness check cannot run there.';
    expect(activityEntryClipboardText(systemEntry({ summary: long }))).toContain(long);
  });
});
