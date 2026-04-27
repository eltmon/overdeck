import { describe, expect, it, vi, beforeEach } from 'vitest';

const execMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, exec: execMock };
});

import {
  applyStash,
  buildStashMessage,
  createNamedStash,
  createRecoveryBranchFromStash,
  dropStash,
  getNextReviewTempSequence,
  isOlderThanDays,
  isSalvageableStash,
  listStashes,
  parseCanonicalStashMessage,
  parseStashListLine,
  popStash,
} from '../stashes.js';

function mockExecImplementation(handler: (cmd: string) => { stdout: string; stderr?: string } | Error) {
  execMock.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
    const callback = (typeof _opts === 'function' ? _opts : cb)!;
    const result = handler(cmd);
    if (result instanceof Error) {
      callback(result);
      return;
    }
    callback(null, { stdout: result.stdout, stderr: result.stderr ?? '' });
  });
}

describe('stashes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds canonical stash messages', () => {
    const when = new Date('2026-04-27T14:15:16.123Z');
    expect(buildStashMessage('pre-spawn', 'pan-879', when)).toBe('pre-spawn:PAN-879:2026-04-27T14:15:16Z');
    expect(buildStashMessage('pre-merge', 'pan-879', when)).toBe('pre-merge:PAN-879:2026-04-27T14:15:16Z');
    expect(buildStashMessage('review-temp', 'pan-879', 3)).toBe('review-temp:PAN-879:3');
    expect(buildStashMessage('salvageable', 'pan-879', when, 'UI Draft + notes')).toBe('salvageable:PAN-879:2026-04-27T14:15:16Z:ui-draft-notes');
  });

  it('parses canonical stash messages and stash list lines', () => {
    const parsed = parseCanonicalStashMessage('salvageable:PAN-879:2026-04-27T14:15:16Z:workspace-notes');
    expect(parsed.kind).toBe('salvageable');
    expect(parsed.issueId).toBe('PAN-879');
    expect(parsed.shortDescription).toBe('workspace-notes');

    const offsetTimestamp = parseCanonicalStashMessage('pre-merge:PAN-879:2026-04-27T14:15:16.123+00:00');
    expect(offsetTimestamp).toMatchObject({
      kind: 'pre-merge',
      issueId: 'PAN-879',
    });
    expect(offsetTimestamp.createdAt?.toISOString()).toBe('2026-04-27T14:15:16.000Z');

    const line = parseStashListLine('stash@{2}\tabc123def456abc123def456abc123def456abcd\t2026-04-27T14:15:16+00:00\tOn feature/pan-879: pre-spawn:PAN-879:2026-04-27T14:15:16Z');
    expect(line).toMatchObject({
      ref: 'abc123def456abc123def456abc123def456abcd',
      stackRef: 'stash@{2}',
      kind: 'pre-spawn',
      issueId: 'PAN-879',
      message: 'pre-spawn:PAN-879:2026-04-27T14:15:16Z',
    });
    expect(line?.createdAt?.toISOString()).toBe('2026-04-27T14:15:16.000Z');

    const wipLine = parseStashListLine('stash@{3}\tdef456abc123def456abc123def456abc123def4\t2026-04-26T10:11:12Z\tWIP on feature/pan-879: salvageable:PAN-879:2026-04-26T10:11:12Z:user-work');
    expect(wipLine).toMatchObject({
      ref: 'def456abc123def456abc123def456abc123def4',
      stackRef: 'stash@{3}',
      kind: 'salvageable',
      shortDescription: 'user-work',
    });

    const reviewTemp = parseCanonicalStashMessage('review-temp:PAN-879:7');
    expect(reviewTemp).toMatchObject({
      kind: 'review-temp',
      issueId: 'PAN-879',
      sequence: 7,
    });

    const multiHyphen = parseCanonicalStashMessage('pre-merge:KRUX-SUB-3:2026-04-27T14:15:16Z');
    expect(multiHyphen).toMatchObject({
      kind: 'pre-merge',
      issueId: 'KRUX-SUB-3',
    });

    expect(parseStashListLine('')).toBeNull();

    const invalidDateLine = parseStashListLine('stash@{1}\tabc123def456abc123def456abc123def456abcd\tnot-a-date\tOn feature/pan-879: pre-spawn:PAN-879:2026-04-27T14:15:16Z');
    expect(invalidDateLine).toMatchObject({
      ref: 'abc123def456abc123def456abc123def456abcd',
      stackRef: 'stash@{1}',
      kind: 'pre-spawn',
    });
    expect(invalidDateLine?.createdAt?.toISOString()).toBe('2026-04-27T14:15:16.000Z');

    const legacyLine = parseStashListLine('stash@{4}: On feature/pan-879: pre-merge:PAN-879:2026-04-27T14:15:16Z');
    expect(legacyLine).toMatchObject({
      ref: 'stash@{4}',
      stackRef: 'stash@{4}',
      kind: 'pre-merge',
    });
  });

  it('computes next review-temp sequence for an issue', () => {
    expect(getNextReviewTempSequence([
      { ref: 'stash@{0}', kind: 'review-temp', issueId: 'PAN-879', message: 'review-temp:PAN-879:2', sequence: 2 },
      { ref: 'stash@{1}', kind: 'review-temp', issueId: 'PAN-879', message: 'review-temp:PAN-879:4', sequence: 4 },
      { ref: 'stash@{2}', kind: 'review-temp', issueId: 'PAN-880', message: 'review-temp:PAN-880:9', sequence: 9 },
    ] as any, 'pan-879')).toBe(5);
  });

  it('returns null when git reports no local changes to save', async () => {
    mockExecImplementation((cmd) => {
      if (cmd.startsWith('git stash push')) return { stdout: 'No local changes to save\n' };
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(createNamedStash('/tmp/workspace', 'pre-spawn:PAN-879:2026-04-27T14:15:16Z')).resolves.toBeNull();
  });

  it('returns the stable stash sha after successful stash creation', async () => {
    mockExecImplementation((cmd) => {
      if (cmd.startsWith('git stash push')) return { stdout: 'Saved working directory and index state WIP\n' };
      if (cmd === 'git rev-parse --verify stash@{0}') return { stdout: 'abc123def456abc123def456abc123def456abcd\n' };
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(createNamedStash('/tmp/workspace', 'pre-spawn:PAN-879:2026-04-27T14:15:16Z')).resolves.toBe('abc123def456abc123def456abc123def456abcd');
  });

  it('lists stashes with stable refs and stack refs', async () => {
    mockExecImplementation((cmd) => {
      if (cmd === 'git stash list --format="%gd%x09%H%x09%cI%x09%gs"') {
        return {
          stdout: [
            'stash@{1}\tabc123def456abc123def456abc123def456abcd\t2026-04-27T14:15:16+00:00\tOn feature/pan-879: pre-spawn:PAN-879:2026-04-27T14:15:16Z',
            'stash@{0}\tdef456abc123def456abc123def456abc123def4\t2026-04-26T10:11:12Z\tWIP on feature/pan-879: salvageable:PAN-879:2026-04-26T10:11:12Z:user-work',
          ].join('\n'),
        };
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(listStashes('/tmp/workspace')).resolves.toMatchObject([
      {
        ref: 'abc123def456abc123def456abc123def456abcd',
        stackRef: 'stash@{1}',
        kind: 'pre-spawn',
      },
      {
        ref: 'def456abc123def456abc123def456abc123def4',
        stackRef: 'stash@{0}',
        kind: 'salvageable',
      },
    ]);
  });

  it('re-resolves a stable stash sha before destructive operations', async () => {
    mockExecImplementation((cmd) => {
      if (cmd === 'git stash list --format="%gd%x09%H%x09%cI%x09%gs"') {
        return {
          stdout: 'stash@{3}\tabc123def456abc123def456abc123def456abcd\t2026-04-27T14:15:16+00:00\tOn feature/pan-879: pre-merge:PAN-879:2026-04-27T14:15:16Z',
        };
      }
      if (cmd === 'git rev-parse --verify "stash@{3}"') return { stdout: 'abc123def456abc123def456abc123def456abcd\n' };
      if (cmd === 'git stash drop "stash@{3}"') return { stdout: '' };
      if (cmd === 'git stash apply "stash@{3}"') return { stdout: '' };
      if (cmd === 'git stash pop "stash@{3}"') return { stdout: '' };
      if (cmd === 'git branch "recovery/PAN-879-ui-draft-notes" "stash@{3}"') return { stdout: '' };
      throw new Error(`unexpected command: ${cmd}`);
    });

    await dropStash('/tmp/workspace', 'abc123def456abc123def456abc123def456abcd');
    await applyStash('/tmp/workspace', 'abc123def456abc123def456abc123def456abcd');
    await popStash('/tmp/workspace', 'abc123def456abc123def456abc123def456abcd');
    await expect(createRecoveryBranchFromStash('/tmp/workspace', 'abc123def456abc123def456abc123def456abcd', 'PAN-879', 'UI Draft + notes')).resolves.toBe('recovery/PAN-879-ui-draft-notes');
  });

  it('identifies salvageable stash entries', () => {
    const salvageable = parseCanonicalStashMessage('salvageable:PAN-879:2026-04-27T14:15:16Z:user-work');
    const unknown = parseCanonicalStashMessage('random stash');

    expect(isSalvageableStash(salvageable)).toBe(true);
    expect(isSalvageableStash(unknown)).toBe(false);
  });

  it('identifies stale timed stashes by age', () => {
    const stash = parseCanonicalStashMessage('pre-merge:PAN-879:2026-03-01T00:00:00Z');
    expect(isOlderThanDays(stash, 28, new Date('2026-04-27T00:00:00Z'))).toBe(true);
    expect(isOlderThanDays(stash, 80, new Date('2026-04-27T00:00:00Z'))).toBe(false);
  });
});
