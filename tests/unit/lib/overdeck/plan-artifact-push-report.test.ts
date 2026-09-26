/**
 * PAN-4224: a `.pan/` push problem that only ever hit stderr never reached an
 * operator who wasn't watching that terminal. describePlanArtifactPush must
 * stay a pure formatter (no false positives on a clean push or a plain skip);
 * surfacePlanArtifactPush must file exactly one dashboard warning per problem
 * and none otherwise.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { emitActivityEntryOncePortable } = vi.hoisted(() => ({
  emitActivityEntryOncePortable: vi.fn(async () => 'appended' as const),
}));
vi.mock('../../../../src/lib/activity-logger.js', () => ({ emitActivityEntryOncePortable }));

import { describePlanArtifactPush, surfacePlanArtifactPush } from '../../../../src/lib/overdeck/plan-artifact-push-report.js';
import type { PushPlanArtifactsResult } from '../../../../src/lib/overdeck/plan-artifact-commit.js';

describe('describePlanArtifactPush', () => {
  it('returns null for a clean push', () => {
    const push: PushPlanArtifactsResult = { pushed: true, sha: 'abc123', rebased: false };
    expect(describePlanArtifactPush(push)).toBeNull();
  });

  it('returns null for a plain skip', () => {
    const push: PushPlanArtifactsResult = { pushed: false, skipped: true, reason: 'main is not ahead of origin/main' };
    expect(describePlanArtifactPush(push)).toBeNull();
  });

  it('returns the warning text for a pushed-with-warning result', () => {
    const push: PushPlanArtifactsResult = {
      pushed: true,
      sha: 'abc123',
      rebased: true,
      warning: 'pushed, but main moved meanwhile; run git pull --rebase in /home/plan',
    };
    expect(describePlanArtifactPush(push)).toEqual({ message: push.warning, details: undefined });
  });

  it('returns the reason for a failed, non-skipped push', () => {
    const push: PushPlanArtifactsResult = { pushed: false, skipped: false, reason: 'could not fetch origin: timed out' };
    expect(describePlanArtifactPush(push)).toEqual({ message: push.reason, details: undefined });
  });

  it('lists each backup as "path -> backup" in details when backedUp is set', () => {
    const push: PushPlanArtifactsResult = {
      pushed: true,
      sha: 'abc123',
      rebased: true,
      backedUp: [
        {
          path: '.pan/continues/PAN-1.xbrief.json',
          backup: '/home/plan/.overdeck/plan-artifact-backups/2026-09-26T00-00-00-000Z/.pan/continues/PAN-1.xbrief.json',
        },
      ],
    };
    const description = describePlanArtifactPush(push);
    expect(description?.message).toBe(
      'moved 1 untracked .pan/ file(s) that differed from origin to /home/plan/.overdeck/plan-artifact-backups/2026-09-26T00-00-00-000Z',
    );
    expect(description?.details).toBe(
      '.pan/continues/PAN-1.xbrief.json -> /home/plan/.overdeck/plan-artifact-backups/2026-09-26T00-00-00-000Z/.pan/continues/PAN-1.xbrief.json',
    );
  });

  it('combines a warning with a backedUp note and lists both backups in details', () => {
    const push: PushPlanArtifactsResult = {
      pushed: true,
      sha: 'abc123',
      rebased: true,
      warning: 'pushed, but main moved meanwhile; run git pull --rebase in /home/plan',
      backedUp: [
        { path: '.pan/state.md', backup: '/home/plan/.overdeck/plan-artifact-backups/x/.pan/state.md' },
        { path: '.pan/notes/a.md', backup: '/home/plan/.overdeck/plan-artifact-backups/x/.pan/notes/a.md' },
      ],
    };
    const description = describePlanArtifactPush(push);
    expect(description?.message).toBe(
      `${push.warning}; moved 2 untracked .pan/ file(s) that differed from origin to /home/plan/.overdeck/plan-artifact-backups/x`,
    );
    expect(description?.details).toBe(
      '.pan/state.md -> /home/plan/.overdeck/plan-artifact-backups/x/.pan/state.md\n' +
        '.pan/notes/a.md -> /home/plan/.overdeck/plan-artifact-backups/x/.pan/notes/a.md',
    );
  });
});

describe('surfacePlanArtifactPush', () => {
  beforeEach(() => {
    emitActivityEntryOncePortable.mockClear();
  });

  it('emits exactly one activity entry with source plan-artifacts, level warn, and a sha1-based id for a problem result', async () => {
    const push: PushPlanArtifactsResult = { pushed: false, skipped: false, reason: 'could not fetch origin: timed out' };

    const description = await surfacePlanArtifactPush(push, { planHome: '/home/plan', command: 'pan backlog write-sequence' });

    expect(description).toEqual({ message: push.reason, details: undefined });
    expect(emitActivityEntryOncePortable).toHaveBeenCalledTimes(1);
    const [call] = emitActivityEntryOncePortable.mock.calls[0]!;
    expect(call).toMatchObject({
      source: 'plan-artifacts',
      level: 'warn',
      command: 'pan backlog write-sequence',
      message: `Plan home /home/plan: ${push.reason}`,
    });
    expect((call as { id: string }).id).toMatch(/^plan-artifact-push:[0-9a-f]{12}$/);
  });

  it('emits nothing for a clean push', async () => {
    const push: PushPlanArtifactsResult = { pushed: true, sha: 'abc123', rebased: false };

    const description = await surfacePlanArtifactPush(push, { planHome: '/home/plan', command: 'pan backlog write-sequence' });

    expect(description).toBeNull();
    expect(emitActivityEntryOncePortable).not.toHaveBeenCalled();
  });
});
