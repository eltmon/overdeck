/**
 * PAN-4753 WI-10: the recent merges strip shows one summary line and expands
 * to the list, with an outside-train merge's warning.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecentMergesStrip } from '../RecentMergesStrip';
import type { RecentMerge } from '../boardTypes';

const RECENT: RecentMerge[] = [
  { issueIds: ['PAN-4296'], sha: 'c0ffee1', mergedAt: '2026-11-14T11:38:00.000Z', via: 'outside-train', warning: 'merged on the forge 4 min before its cooldown ended' },
  { issueIds: ['PAN-4290', 'PAN-4291'], sha: 'abc1234', mergedAt: '2026-11-14T09:00:00.000Z', via: 'batch', batchName: 'uat/pan-train-1114-1', version: '0.85.0' },
  { issueIds: ['PAN-4280'], sha: null, mergedAt: '2026-11-14T08:00:00.000Z', via: 'auto-merge' },
];

describe('RecentMergesStrip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the one-line summary', () => {
    render(<RecentMergesStrip recent={RECENT} />);
    const strip = screen.getByTestId('recent-merges');
    expect(strip.textContent).toContain('Last merged:');
    expect(strip.textContent).toContain('PAN-4296');
    expect(strip.textContent).toContain('22m ago');
    expect(screen.getByRole('button', { name: 'show 3' })).toBeTruthy();
    expect(screen.queryByTestId('recent-merges-list')).toBeNull();
  });

  it('expands to the list with attribution and the outside-train warning', () => {
    render(<RecentMergesStrip recent={RECENT} />);
    fireEvent.click(screen.getByRole('button', { name: 'show 3' }));
    const list = screen.getByTestId('recent-merges-list');
    expect(list.textContent).toContain('outside the train');
    expect(list.textContent).toContain('merged on the forge 4 min before its cooldown ended');
    expect(list.textContent).toContain('batch pan-train-1114-1 · v0.85.0');
    expect(list.textContent).toContain('auto-merge');
    expect(list.textContent).toContain('c0ffee1');
  });

  it('renders nothing with no merges', () => {
    const { container } = render(<RecentMergesStrip recent={[]} />);
    expect(container.textContent).toBe('');
  });
});
