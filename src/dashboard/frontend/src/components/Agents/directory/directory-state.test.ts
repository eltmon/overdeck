import type { DirectoryEntry } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import { displayStateOf, hoursSince, known } from './directory-state';

function entry(overrides: Partial<DirectoryEntry>): DirectoryEntry {
  return {
    id: 'agent-pan-1', kind: 'agent', label: 'work · PAN-1', location: 'local', projectKey: 'overdeck',
    issueId: 'PAN-1', issueTitle: null, parentId: null, role: 'work', harness: 'claude-code', model: 'm',
    state: 'idle', startedAt: null, lastActivityAt: null, costUsd: null, source: 'overdeck', transcript: null,
    ...overrides,
  };
}

describe('displayStateOf', () => {
  it('keeps blocked above every issue attention', () => {
    expect(displayStateOf(entry({ state: 'blocked' }), 'stuck')).toBe('blocked');
  });

  it('marks only the idle work agent of a stuck issue as stuck', () => {
    expect(displayStateOf(entry({}), 'stuck')).toBe('stuck');
    expect(displayStateOf(entry({ state: 'working' }), 'stuck')).toBe('working');
    expect(displayStateOf(entry({ role: 'review' }), 'stuck')).toBe('idle');
    expect(displayStateOf(entry({ kind: 'subagent' }), 'stuck')).toBe('idle');
  });

  it('marks a live work agent of an api-error issue', () => {
    expect(displayStateOf(entry({ state: 'working' }), 'api-error')).toBe('api-error');
    expect(displayStateOf(entry({ state: 'stopped' }), 'api-error')).toBe('stopped');
  });

  it('never answers unknown', () => {
    expect(displayStateOf(entry({ state: 'unknown', location: 'remote' }))).toBe('remote');
    expect(displayStateOf(entry({ state: 'unknown' }))).toBe('no-status');
  });
});

describe('known / hoursSince', () => {
  it('hides the unknown placeholder', () => {
    expect(known('unknown')).toBeNull();
    expect(known('')).toBeNull();
    expect(known('gpt-5.5')).toBe('gpt-5.5');
  });

  it('counts whole hours', () => {
    expect(hoursSince('2026-09-23T09:10:00.000Z', new Date('2026-09-23T12:00:00.000Z'))).toBe(2);
    expect(hoursSince(null, new Date())).toBeUndefined();
  });
});
