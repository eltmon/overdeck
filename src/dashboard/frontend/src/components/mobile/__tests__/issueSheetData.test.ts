import type { DirectoryEntry } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import type { Agent } from '../../../types';
import { DIRECTORY_STATE_LABELS, eventLine, formatEventTime, isLiveDirectoryResponse, pickIssueAgent } from '../issueSheetData';

function directoryEntry(overrides: Partial<DirectoryEntry>): DirectoryEntry {
  return {
    id: overrides.id ?? 'a1',
    kind: 'agent',
    label: 'a1',
    location: 'local',
    projectKey: 'pan',
    issueId: 'PAN-1',
    issueTitle: null,
    parentId: null,
    role: 'work',
    harness: 'claude-code',
    model: 'opus',
    state: 'working',
    startedAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    costUsd: null,
    source: 'overdeck',
    transcript: null,
    ...overrides,
  };
}

function storeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: overrides.id ?? 'agent-1',
    issueId: 'PAN-1',
    runtime: 'claude-code',
    model: 'opus',
    status: 'stopped',
    startedAt: '2026-01-01T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

describe('formatEventTime', () => {
  it('shows a time for the same local calendar day as now', () => {
    const now = new Date('2026-11-13T23:00:00.000Z');
    const at = '2026-11-13T19:43:00.000Z';
    expect(formatEventTime(at, now)).toBe(new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
  });

  it('shows a date and time for another day', () => {
    const now = new Date('2026-11-14T23:00:00.000Z');
    const at = '2026-11-13T19:43:00.000Z';
    expect(formatEventTime(at, now)).toBe(
      new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    );
  });

  it('returns null for an unparsable at', () => {
    expect(formatEventTime('not-a-date', new Date())).toBeNull();
  });
});

describe('eventLine', () => {
  const now = new Date('2026-11-13T23:00:00.000Z');

  it('names the PR number for merge.completed with a known PR', () => {
    const line = eventLine({ kind: 'merge.completed', at: '2026-11-13T19:43:00.000Z' }, 12, now);
    expect(line).toContain('Merged PR #12 at');
  });

  it('gives the plain label for stopped with no at', () => {
    expect(eventLine({ kind: 'stopped', at: null }, null, now)).toBe('Agent stopped responding');
  });

  it('gives the plain label for merge.completed with no known PR', () => {
    expect(eventLine({ kind: 'merge.completed', at: null }, null, now)).toBe('Merged');
  });

  it('omits the time suffix when at cannot be parsed', () => {
    expect(eventLine({ kind: 'merge.failed', at: 'nope' }, null, now)).toBe('Merge failed');
  });
});

describe('isLiveDirectoryResponse', () => {
  it('accepts an object with an entries array and rejects everything else', () => {
    expect(isLiveDirectoryResponse({ entries: [] })).toBe(true);
    expect(isLiveDirectoryResponse({ entries: 'nope' })).toBe(false);
    expect(isLiveDirectoryResponse(null)).toBe(false);
    expect(isLiveDirectoryResponse([])).toBe(false);
  });
});

describe('pickIssueAgent', () => {
  const NOW_MS = Date.parse('2026-01-02T00:00:00.000Z');

  it('picks the latest of two live entries', () => {
    const older = directoryEntry({ id: 'a1', lastActivityAt: '2026-01-01T00:00:00.000Z' });
    const newer = directoryEntry({ id: 'a2', lastActivityAt: '2026-01-01T12:00:00.000Z' });
    const picked = pickIssueAgent('PAN-1', [older, newer], [], NOW_MS);
    expect(picked).toMatchObject({ lastActivityAt: newer.lastActivityAt, more: 1 });
  });

  it('labels an idle entry "Idle"', () => {
    const picked = pickIssueAgent('PAN-1', [directoryEntry({ state: 'idle' })], [], NOW_MS);
    expect(picked?.status).toBe(DIRECTORY_STATE_LABELS.idle);
  });

  it('falls back to the store "Stopped" when the directory answered with no entry for the issue', () => {
    const picked = pickIssueAgent('PAN-1', [directoryEntry({ issueId: 'PAN-2' })], [storeAgent({})], NOW_MS);
    expect(picked).toMatchObject({ status: 'Stopped' });
  });

  it('gives "Live" for a null directory and a store agent with hasLivePane true', () => {
    const picked = pickIssueAgent('PAN-1', null, [storeAgent({ hasLivePane: true })], NOW_MS);
    expect(picked?.status).toBe('Live');
  });

  it('returns null when no agent is known anywhere', () => {
    expect(pickIssueAgent('PAN-1', [], [], NOW_MS)).toBeNull();
    expect(pickIssueAgent('PAN-1', null, [], NOW_MS)).toBeNull();
  });

  it('ignores conversation entries', () => {
    const picked = pickIssueAgent('PAN-1', [directoryEntry({ kind: 'conversation' })], [], NOW_MS);
    expect(picked).toBeNull();
  });
});
