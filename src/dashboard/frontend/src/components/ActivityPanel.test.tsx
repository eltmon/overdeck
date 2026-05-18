/**
 * Tests for ActivityPanel pure logic helpers (PAN-653)
 *
 * Covers:
 *   - inferCategory(): source → category mapping
 *   - mergeActivitiesById(): dedup from multiple sources, newest-first sort
 *   - applyPinWarnings(): warn/error pinned to top
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { inferCategory, mergeActivitiesById, applyPinWarnings, ActivityPanel } from './ActivityPanel';
import type { ActivityEntry, TtsEntry } from './ActivityPanel';

// ── ActivityPanel component tests ─────────────────────────────────────────────

const dashboardState: {
  recentActivity: ActivityEntry[];
  detailedActivity: ActivityEntry[];
  ttsActivity: TtsEntry[];
} = {
  recentActivity: [],
  detailedActivity: [],
  ttsActivity: [],
};

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

vi.mock('../lib/store', () => ({
  useDashboardStore: (selector: (s: typeof dashboardState) => unknown) => selector(dashboardState),
}));

function renderPanel(fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.stubGlobal('fetch', fetchImpl);
  return render(
    <QueryClientProvider client={client}>
      <ActivityPanel onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('ActivityPanel', () => {
  beforeEach(() => {
    dashboardState.recentActivity = [];
    dashboardState.detailedActivity = [];
    dashboardState.ttsActivity = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not show Clear button when all filters are at defaults', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Filter'));
    // Clear is only visible when a non-default filter is active
    expect(screen.queryByText('Clear')).toBeNull();
  });

  it('shows Clear button when a filter is set', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Filter'));
    // Change level filter away from 'all'
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'error' } });
    expect(screen.getByText('Clear')).toBeTruthy();
  });

  it('Clear resets level/source/category/search but preserves pinWarnings=true', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Filter'));

    // Set a non-default filter to make Clear visible
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'error' } });
    // pinWarnings checkbox starts checked (default true); leave it checked
    const pinCheckbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(pinCheckbox.checked).toBe(true);

    fireEvent.click(screen.getByText('Clear'));

    // Level reset to 'all'
    expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('all');
    // pinWarnings preserved: checkbox still checked
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    // Clear button gone (all filters back to defaults)
    expect(screen.queryByText('Clear')).toBeNull();
  });

  it('Clear preserves pinWarnings=false when user unchecked it', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Filter'));

    // Uncheck pinWarnings
    fireEvent.click(screen.getByRole('checkbox'));
    // Set a filter to make Clear visible
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'warn' } });

    fireEvent.click(screen.getByText('Clear'));

    // pinWarnings preserved as false
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    // Other filters reset
    expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('all');
  });

  it('replays TTS utterances from the TTS tab', async () => {
    dashboardState.ttsActivity = [{
      id: 'tts-1',
      timestamp: new Date().toISOString(),
      utterance: 'PAN-829 is ready to merge',
      priority: 1,
      issueId: 'PAN-829',
    }];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (input.toString() === '/api/tts/speak') return { ok: true, json: async () => ({ spoken: true, result: 'spoken' }) } as Response;
      return { ok: true, json: async () => [] } as Response;
    });
    renderPanel(fetchMock);

    fireEvent.click(screen.getByRole('button', { name: 'TTS' }));
    expect(screen.getByText('PAN-829 is ready to merge')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tts-activity-replay-tts-1'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'PAN-829 is ready to merge' }),
      });
    });
  });

  it('reports TTS replay no-op responses as errors', async () => {
    dashboardState.ttsActivity = [{
      id: 'tts-1',
      timestamp: new Date().toISOString(),
      utterance: 'PAN-829 is muted',
      priority: 1,
      issueId: 'PAN-829',
    }];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (input.toString() === '/api/tts/speak') return { ok: true, json: async () => ({ spoken: false, result: 'muted' }) } as Response;
      return { ok: true, json: async () => [] } as Response;
    });
    renderPanel(fetchMock);

    fireEvent.click(screen.getByRole('button', { name: 'TTS' }));
    fireEvent.click(screen.getByTestId('tts-activity-replay-tts-1'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to replay TTS: TTS did not speak (muted)'));
  });
});

function makeEntry(partial: Partial<ActivityEntry> & { id: string }): ActivityEntry {
  return {
    timestamp: '2026-04-01T00:00:00.000Z',
    source: 'dashboard',
    level: 'info',
    message: 'test message',
    ...partial,
  };
}

// ─── inferCategory ────────────────────────────────────────────────────────────

describe('inferCategory', () => {
  it('returns explicit category if set', () => {
    const entry = makeEntry({ id: '1', source: 'anything', category: 'git' });
    expect(inferCategory(entry)).toBe('git');
  });

  it('returns "git" for source === "git"', () => {
    expect(inferCategory(makeEntry({ id: '1', source: 'git' }))).toBe('git');
  });

  it('returns "role" for role sources', () => {
    expect(inferCategory(makeEntry({ id: '1', source: 'plan' }))).toBe('role');
    expect(inferCategory(makeEntry({ id: '2', source: 'work' }))).toBe('role');
    expect(inferCategory(makeEntry({ id: '3', source: 'review' }))).toBe('role');
    expect(inferCategory(makeEntry({ id: '4', source: 'test' }))).toBe('role');
    expect(inferCategory(makeEntry({ id: '5', source: 'ship' }))).toBe('role');
  });

  it('returns "sync" for source containing "sync"', () => {
    expect(inferCategory(makeEntry({ id: '1', source: 'auto-sync' }))).toBe('sync');
  });

  it('returns "sync" for source containing "pull"', () => {
    expect(inferCategory(makeEntry({ id: '1', source: 'pull-watcher' }))).toBe('sync');
  });

  it('returns "other" for unrecognized sources', () => {
    expect(inferCategory(makeEntry({ id: '1', source: 'dashboard' }))).toBe('other');
    expect(inferCategory(makeEntry({ id: '1', source: 'cloister' }))).toBe('other');
  });

  it('returns "other" for empty source', () => {
    expect(inferCategory(makeEntry({ id: '1', source: '' }))).toBe('other');
  });
});

// ─── mergeActivitiesById ──────────────────────────────────────────────────────

describe('mergeActivitiesById', () => {
  it('deduplicates entries with the same id across sources', () => {
    const a1 = makeEntry({ id: 'x', source: 'first', message: 'first version' });
    const a2 = makeEntry({ id: 'x', source: 'second', message: 'second version' });
    const result = mergeActivitiesById([a1], [a2]);
    expect(result).toHaveLength(1);
    // Last write wins (git-activity source overwrites REST)
    expect(result[0].source).toBe('second');
  });

  it('merges distinct entries from multiple sources', () => {
    const store = [makeEntry({ id: '1', timestamp: '2026-04-01T10:00:00.000Z' })];
    const rest  = [makeEntry({ id: '2', timestamp: '2026-04-01T09:00:00.000Z' })];
    const git   = [makeEntry({ id: '3', timestamp: '2026-04-01T08:00:00.000Z' })];
    const result = mergeActivitiesById(store, rest, git);
    expect(result).toHaveLength(3);
    expect(result.map(e => e.id)).toEqual(['1', '2', '3']);
  });

  it('sorts newest-first by timestamp', () => {
    const older = makeEntry({ id: 'a', timestamp: '2026-04-01T08:00:00.000Z' });
    const newer = makeEntry({ id: 'b', timestamp: '2026-04-01T10:00:00.000Z' });
    const result = mergeActivitiesById([older, newer]);
    expect(result[0].id).toBe('b');
    expect(result[1].id).toBe('a');
  });

  it('handles empty arrays without throwing', () => {
    const result = mergeActivitiesById([], [], []);
    expect(result).toHaveLength(0);
  });

  it('handles a single source', () => {
    const entries = [makeEntry({ id: '1' }), makeEntry({ id: '2' })];
    expect(mergeActivitiesById(entries)).toHaveLength(2);
  });
});

// ─── applyPinWarnings ─────────────────────────────────────────────────────────

describe('applyPinWarnings', () => {
  it('returns list unchanged when pinWarnings is false', () => {
    const entries = [
      makeEntry({ id: '1', level: 'info' }),
      makeEntry({ id: '2', level: 'warn' }),
      makeEntry({ id: '3', level: 'success' }),
    ];
    const result = applyPinWarnings(entries, false);
    expect(result.map(e => e.id)).toEqual(['1', '2', '3']);
  });

  it('moves warn entries to the front when pinWarnings is true', () => {
    const entries = [
      makeEntry({ id: '1', level: 'info' }),
      makeEntry({ id: '2', level: 'warn' }),
      makeEntry({ id: '3', level: 'success' }),
    ];
    const result = applyPinWarnings(entries, true);
    expect(result[0].id).toBe('2');
    expect(result.slice(1).map(e => e.id)).toEqual(['1', '3']);
  });

  it('moves error entries to the front when pinWarnings is true', () => {
    const entries = [
      makeEntry({ id: '1', level: 'info' }),
      makeEntry({ id: '2', level: 'error' }),
    ];
    const result = applyPinWarnings(entries, true);
    expect(result[0].id).toBe('2');
    expect(result[1].id).toBe('1');
  });

  it('preserves relative order within pinned group and non-pinned group', () => {
    const entries = [
      makeEntry({ id: 'i1', level: 'info' }),
      makeEntry({ id: 'w1', level: 'warn' }),
      makeEntry({ id: 'i2', level: 'success' }),
      makeEntry({ id: 'w2', level: 'error' }),
    ];
    const result = applyPinWarnings(entries, true);
    expect(result.map(e => e.id)).toEqual(['w1', 'w2', 'i1', 'i2']);
  });

  it('returns empty list for empty input', () => {
    expect(applyPinWarnings([], true)).toHaveLength(0);
    expect(applyPinWarnings([], false)).toHaveLength(0);
  });

  it('works when all entries are warn/error', () => {
    const entries = [
      makeEntry({ id: '1', level: 'warn' }),
      makeEntry({ id: '2', level: 'error' }),
    ];
    const result = applyPinWarnings(entries, true);
    expect(result.map(e => e.id)).toEqual(['1', '2']);
  });

  it('works when no entries are warn/error', () => {
    const entries = [
      makeEntry({ id: '1', level: 'info' }),
      makeEntry({ id: '2', level: 'success' }),
    ];
    const result = applyPinWarnings(entries, true);
    expect(result.map(e => e.id)).toEqual(['1', '2']);
  });
});
