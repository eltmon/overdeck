/**
 * PAN-4264 Work Item 9: the repo PR cache read goes through the quota meter.
 * During a user-pool GraphQL pause it reads as "failed" (null) without
 * spawning gh, never as "no PRs".
 */
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gh = vi.hoisted(() => ({ calls: [] as string[][], stdout: '[]' }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  function execFileStub(..._args: unknown[]): never {
    throw new Error('execFile without promisify is not expected in these tests');
  }
  (execFileStub as unknown as Record<PropertyKey, unknown>)[promisify.custom] =
    (cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
      if (cmd !== 'gh') return Promise.reject(new Error(`unexpected execFile: ${cmd}`));
      gh.calls.push(args);
      return Promise.resolve({ stdout: gh.stdout, stderr: '' });
    };
  return { ...actual, execFile: execFileStub };
});

import { readRepoPullRequests } from '../../../../src/lib/overdeck/derived-issue-state.js';
import { flushLedgerWrites, readLedgerWindow } from '../../../../src/lib/github-quota/ledger.js';
import { recordGitHubRefusal } from '../../../../src/lib/github-quota/pause-gate.js';

// Module-level caches outlive a test, so each test uses its own repo path.
let repoSeq = 0;

describe('readRepoPullRequests quota metering (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-pr-cache-quota-'));
    process.env.OVERDECK_HOME = home;
    gh.calls.length = 0;
  });

  afterEach(async () => {
    await flushLedgerWrites();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('returns null and never execs gh during a user GraphQL pause', async () => {
    await recordGitHubRefusal({ pool: 'user', bucket: 'graphql', caller: 'pr-sync', refusal: { kind: 'primary' } });

    await expect(readRepoPullRequests(`/repos/quota-${++repoSeq}`)).resolves.toBeNull();
    expect(gh.calls).toEqual([]);
  });

  it('meters a successful listing as caller pr-cache', async () => {
    gh.stdout = JSON.stringify([{ number: 1, state: 'OPEN', headRefName: 'feature/pan-1' }]);

    const rows = await readRepoPullRequests(`/repos/quota-${++repoSeq}`);
    expect(rows).toHaveLength(1);
    expect(gh.calls[0]!.slice(0, 2)).toEqual(['pr', 'list']);

    await flushLedgerWrites();
    expect(readLedgerWindow(Date.now())).toEqual([expect.objectContaining({
      caller: 'pr-cache', pool: 'user', bucket: 'graphql', outcome: 'ok',
    })]);
  });
});
