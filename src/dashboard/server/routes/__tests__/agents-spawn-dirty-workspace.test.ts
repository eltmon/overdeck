import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockEmitActivityEntrySync = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/activity-logger.js', () => ({
  emitActivityEntrySync: mockEmitActivityEntrySync,
}));

import {
  emitDirtyWorkspaceRefusalActivity,
  isOnlyOverdeckRuntimeWorkspaceChanges,
} from '../agents/spawn.js';

describe('isOnlyOverdeckRuntimeWorkspaceChanges', () => {
  it.each([
    ['an unexpanded legacy runtime directory', '?? .pan/'],
    ['a canonical workspace spec', ' M .overdeck/spec.vbrief.json'],
    ['a canonical continue file', ' M .overdeck/continue.json'],
    ['a legacy workspace spec', '?? .pan/spec.vbrief.json'],
    ['a legacy continue file', '?? .pan/continue.json'],
  ])('allows %s', (_label, porcelain) => {
    expect(isOnlyOverdeckRuntimeWorkspaceChanges(porcelain)).toBe(true);
  });

  it.each([
    ['a source file', ' M src/index.ts'],
    ['runtime files mixed with a source file', '?? .pan/spec.vbrief.json\n M src/index.ts'],
    ['an unknown legacy path', '?? .pan/user-notes.md'],
  ])('rejects %s', (_label, porcelain) => {
    expect(isOnlyOverdeckRuntimeWorkspaceChanges(porcelain)).toBe(false);
  });
});

describe('emitDirtyWorkspaceRefusalActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits a warn-level dashboard activity event with issueId and truncated porcelain', () => {
    emitDirtyWorkspaceRefusalActivity('MIN-857', [
      'M .pan/records/min-857.json',
      '?? api/',
      '?? docs/',
      '?? fe/',
      '?? infra/',
      '?? myn-skills/',
      '?? openclaw-plugin/',
    ].join('\n'));

    expect(mockEmitActivityEntrySync).toHaveBeenCalledTimes(1);
    const call = mockEmitActivityEntrySync.mock.calls[0][0];
    expect(call.source).toBe('dashboard');
    expect(call.level).toBe('warn');
    expect(call.message).toBe('Workspace dirty — agent start refused for MIN-857');
    expect(call.issueId).toBe('MIN-857');

    const details = JSON.parse(call.details);
    expect(details.reason).toContain('uncommitted changes');
    expect(details.porcelain).toEqual([
      'M .pan/records/min-857.json',
      '?? api/',
      '?? docs/',
      '?? fe/',
      '?? infra/',
    ]);
  });

  it('does not throw when emitActivityEntrySync throws', () => {
    mockEmitActivityEntrySync.mockImplementation(() => {
      throw new Error('event store unavailable');
    });

    expect(() => emitDirtyWorkspaceRefusalActivity('PAN-123', 'M file.txt')).not.toThrow();
  });
});
