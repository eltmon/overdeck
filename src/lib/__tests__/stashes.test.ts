import { describe, expect, it, vi, beforeEach } from 'vitest';

const execMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, exec: execMock };
});

import {
  buildStashMessage,
  createNamedStash,
  isOlderThanDays,
  parseCanonicalStashMessage,
  parseStashListLine,
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

    const line = parseStashListLine('stash@{2}: On feature/pan-879: pre-spawn:PAN-879:2026-04-27T14:15:16Z');
    expect(line).toMatchObject({
      ref: 'stash@{2}',
      kind: 'pre-spawn',
      issueId: 'PAN-879',
      message: 'pre-spawn:PAN-879:2026-04-27T14:15:16Z',
    });
  });

  it('returns null when git reports no local changes to save', async () => {
    mockExecImplementation((cmd) => {
      if (cmd.startsWith('git stash push')) return { stdout: 'No local changes to save\n' };
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(createNamedStash('/tmp/workspace', 'pre-spawn:PAN-879:2026-04-27T14:15:16Z')).resolves.toBeNull();
  });

  it('returns the matching stash ref after creating a named stash', async () => {
    mockExecImplementation((cmd) => {
      if (cmd.startsWith('git stash push')) return { stdout: 'Saved working directory and index state WIP\n' };
      if (cmd === 'git stash list') {
        return {
          stdout: [
            'stash@{0}: On feature/pan-879: pre-spawn:PAN-879:2026-04-27T14:15:16Z',
            'stash@{1}: On feature/pan-879: salvageable:PAN-879:2026-04-20T10:00:00Z:notes',
          ].join('\n'),
        };
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(createNamedStash('/tmp/workspace', 'pre-spawn:PAN-879:2026-04-27T14:15:16Z')).resolves.toBe('stash@{0}');
  });

  it('identifies stale timed stashes by age', () => {
    const stash = parseCanonicalStashMessage('pre-merge:PAN-879:2026-03-01T00:00:00Z');
    expect(isOlderThanDays(stash, 28, new Date('2026-04-27T00:00:00Z'))).toBe(true);
    expect(isOlderThanDays(stash, 80, new Date('2026-04-27T00:00:00Z'))).toBe(false);
  });
});
