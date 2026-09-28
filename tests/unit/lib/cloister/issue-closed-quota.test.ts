/**
 * PAN-4264 Work Item 12: tracker state reads take their GitHub caller from
 * context. The reaper's `close-out` context is non-essential and is skipped
 * during a GraphQL pause (never read as "open"); closeOut()/`pan close` call
 * the same reader with no context and stay essential.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execFileAsync: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  function execFile(): void {
    throw new Error('execFile callback form is not used in these tests');
  }
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = mocks.execFileAsync;
  return { ...actual, execFile };
});

vi.mock('../../../../src/lib/tracker-utils.js', () => ({
  resolveGitHubIssue: () => ({ isGitHub: true, owner: 'eltmon', repo: 'overdeck', number: 4264 }),
  resolveTrackerType: () => 'github',
}));

vi.mock('../../../../src/lib/github-app.js', () => ({
  getIssueState: vi.fn(),
  isGitHubAppConfigured: () => false,
}));

import { readLiveTrackerIssueState } from '../../../../src/lib/cloister/issue-closed.js';
import { withGitHubCaller } from '../../../../src/lib/github-quota/caller-context.js';
import { flushLedgerWrites } from '../../../../src/lib/github-quota/ledger.js';
import { GitHubQuotaPausedError, recordGitHubRefusal } from '../../../../src/lib/github-quota/pause-gate.js';

describe('readLiveTrackerIssueState quota gating (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'pan-close-out-quota-'));
    process.env.OVERDECK_HOME = home;
    mocks.execFileAsync.mockReset();
    mocks.execFileAsync.mockResolvedValue({ stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' });
    await recordGitHubRefusal({ pool: 'user', bucket: 'graphql', caller: 'pr-sync', refusal: { kind: 'primary' } });
  });

  afterEach(async () => {
    await flushLedgerWrites();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('throws GitHubQuotaPausedError from the reaper close-out context and never returns open', async () => {
    await expect(withGitHubCaller('close-out', () => readLiveTrackerIssueState('PAN-4264')))
      .rejects.toBeInstanceOf(GitHubQuotaPausedError);
    expect(mocks.execFileAsync).not.toHaveBeenCalled();
  });

  it('still execs gh with no caller context (closeOut / pan close stay essential)', async () => {
    await expect(readLiveTrackerIssueState('PAN-4264')).resolves.toBe('open');
    expect(mocks.execFileAsync).toHaveBeenCalledWith(
      'gh',
      ['issue', 'view', '4264', '--repo', 'eltmon/overdeck', '--json', 'state'],
      expect.objectContaining({ timeout: 10_000 }),
    );
  });
});
