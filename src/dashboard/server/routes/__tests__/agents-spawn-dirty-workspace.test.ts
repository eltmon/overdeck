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
    // PAN-3042: the gate runs with --untracked-files=all, so it never sees the
    // collapsed `?? .pan/` form — it sees expanded paths like this
    // pipeline-authored PRD draft, which used to read as operator dirt and 409
    // the planning→work auto-handoff.
    ['an expanded pipeline-authored PRD draft', '?? .pan/drafts/MIN-898.md'],
    ['any other Overdeck-owned .pan/ path', '?? .pan/user-notes.md'],
    // PAN-3266: worktree creation writes the Overdeck pre-rebase guard into
    // core.hooksPath (.husky/_), creating that directory before husky's install
    // has written its self-ignoring `.gitignore`. Every freshly created
    // workspace was therefore born dirty and 409'd the planning auto-handoff.
    ['the generated pre-rebase guard in a fresh workspace', '?? .husky/_/pre-rebase'],
    ['generated hook output beside pipeline runtime files', '?? .husky/_/pre-rebase\n?? .pan/drafts/PAN-3254.md'],
  ])('allows %s', (_label, porcelain) => {
    expect(isOnlyOverdeckRuntimeWorkspaceChanges(porcelain)).toBe(true);
  });

  it.each([
    ['a source file', ' M src/index.ts'],
    ['runtime files mixed with a source file', '?? .pan/spec.vbrief.json\n M src/index.ts'],
    ['a runtime-lookalike path outside the runtime dirs', '?? pan/drafts/MIN-898.md'],
    ['generated hook output mixed with a source file', '?? .husky/_/pre-rebase\n M src/index.ts'],
    ['an edit to a tracked hook source', ' M .husky/pre-push'],
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
