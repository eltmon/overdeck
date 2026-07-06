import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockEmitActivityEntrySync = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/activity-logger.js', () => ({
  emitActivityEntrySync: mockEmitActivityEntrySync,
}));

import { emitDirtyWorkspaceRefusalActivity } from '../agents/spawn.js';

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
