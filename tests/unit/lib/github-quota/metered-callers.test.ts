/**
 * PAN-4264: the migrated callers record the right caller, bucket and cost when
 * they exec gh through the real runGh door (child_process mocked).
 */
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gh = vi.hoisted(() => ({ stdout: '{}', calls: [] as string[][], env: [] as Array<Record<string, string | undefined>> }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  function execFileStub(..._args: unknown[]): never {
    throw new Error('execFile without promisify is not expected in these tests');
  }
  (execFileStub as unknown as Record<PropertyKey, unknown>)[promisify.custom] =
    (cmd: string, args: string[], options: { env?: Record<string, string | undefined> }): Promise<{ stdout: string; stderr: string }> => {
      if (cmd !== 'gh') return Promise.reject(new Error(`unexpected execFile: ${cmd}`));
      gh.calls.push(args);
      gh.env.push(options?.env ?? {});
      return Promise.resolve({ stdout: gh.stdout, stderr: '' });
    };
  return { ...actual, execFile: execFileStub };
});

import { runGitHubGraphql } from '../../../../src/lib/github-graphql-run.js';
import { flushLedgerWrites, readLedgerWindow } from '../../../../src/lib/github-quota/ledger.js';
import { listOpenPullRequestsSnapshot } from '../../../../src/lib/pipeline-membership-gather.js';
import { refreshPullRequestLinkNow } from '../../../../src/dashboard/server/services/pull-request-sync-service.js';

describe('metered gh callers (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-metered-callers-'));
    process.env.OVERDECK_HOME = home;
    gh.calls.length = 0;
    gh.env.length = 0;
  });

  afterEach(async () => {
    await flushLedgerWrites();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  async function ledger() {
    await flushLedgerWrites();
    return readLedgerWindow(Date.now());
  }

  it('runGitHubGraphql records the real GraphQL cost from data.rateLimit', async () => {
    gh.stdout = JSON.stringify({ data: { repository: {}, rateLimit: { cost: 3, remaining: 4990, limit: 5000, resetAt: '2026-09-27T16:00:00Z' } } });
    await runGitHubGraphql('query { repository(owner: "o", name: "r") { id } rateLimit { cost remaining resetAt limit } }');
    expect(await ledger()).toEqual([expect.objectContaining({ bucket: 'graphql', cost: 3, estimated: false, remaining: 4990 })]);
    // The agent gh shim skips calls runGh already metered.
    expect(gh.env[0]?.OVERDECK_GH_METERED).toBe('1');
  });

  it('the open-PR snapshot records caller pipeline-membership in the REST bucket', async () => {
    gh.stdout = JSON.stringify([[{ number: 1, title: 't', html_url: 'u', state: 'open', head: { ref: 'feature/pan-1', repo: { full_name: 'o/r' } }, base: { ref: 'main' } }]]);
    await expect(listOpenPullRequestsSnapshot('metered-owner', 'metered-repo')).resolves.toHaveLength(1);
    expect(await ledger()).toEqual([expect.objectContaining({ caller: 'pipeline-membership', pool: 'user', bucket: 'rest' })]);
  });

  it('the PR sync gh pr view read records caller pr-sync', async () => {
    gh.stdout = 'not json';
    await expect(refreshPullRequestLinkNow({
      host: 'github.com', repository: 'o/r', number: 5, url: 'https://github.com/o/r/pull/5',
    } as never)).resolves.toEqual([]);
    expect(gh.calls[0]?.slice(0, 3)).toEqual(['pr', 'view', '5']);
    expect(await ledger()).toEqual([expect.objectContaining({ caller: 'pr-sync', bucket: 'graphql' })]);
  });
});
