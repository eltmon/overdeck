/**
 * PAN-4264 Work Item 11: the CI repair gh api helper is metered as caller
 * ci-repair and skipped during a user REST pause.
 */
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gh = vi.hoisted(() => ({ calls: [] as string[][] }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  function execFileStub(..._args: unknown[]): never {
    throw new Error('execFile without promisify is not expected in these tests');
  }
  (execFileStub as unknown as Record<PropertyKey, unknown>)[promisify.custom] =
    (cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
      if (cmd !== 'gh') return Promise.reject(new Error(`unexpected execFile: ${cmd}`));
      gh.calls.push(args);
      return Promise.resolve({ stdout: '{"commit":{"sha":"abc"}}', stderr: '' });
    };
  return { ...actual, execFile: execFileStub };
});

import { projectCiGhApi, resolveDefaultBranchHead } from '../../../../src/lib/ci/project-ci-github.js';
import { flushLedgerWrites, readLedgerWindow } from '../../../../src/lib/github-quota/ledger.js';
import { GitHubQuotaPausedError, recordGitHubRefusal } from '../../../../src/lib/github-quota/pause-gate.js';

describe('projectCiGhApi quota metering (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-ci-quota-'));
    process.env.OVERDECK_HOME = home;
    gh.calls.length = 0;
  });

  afterEach(async () => {
    await flushLedgerWrites();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('rejects with GitHubQuotaPausedError during a user REST pause without exec', async () => {
    await recordGitHubRefusal({ pool: 'user', bucket: 'rest', caller: 'ci-repair', refusal: { kind: 'primary' } });

    await expect(projectCiGhApi('repos/o/r/branches/main')).rejects.toBeInstanceOf(GitHubQuotaPausedError);
    expect(gh.calls).toEqual([]);
  });

  it('meters a successful read as caller ci-repair in the user REST bucket', async () => {
    await expect(resolveDefaultBranchHead('o/r', 'main')).resolves.toBe('abc');
    expect(gh.calls).toEqual([['api', 'repos/o/r/branches/main', '-H', 'Accept: application/vnd.github+json']]);

    await flushLedgerWrites();
    expect(readLedgerWindow(Date.now())).toEqual([expect.objectContaining({
      caller: 'ci-repair', pool: 'user', bucket: 'rest', estimated: false, outcome: 'ok',
    })]);
  });
});
