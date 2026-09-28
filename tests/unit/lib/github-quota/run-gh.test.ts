/**
 * PAN-4264 Work Item 3: runGh meters every gh exec, records rate-limit
 * refusals as pauses, and skips non-essential callers during a pause.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { withGitHubCaller } from '../../../../src/lib/github-quota/caller-context.js';
import { flushLedgerWrites, getGitHubQuotaDir, readLedgerWindow } from '../../../../src/lib/github-quota/ledger.js';
import {
  GitHubQuotaPausedError,
  GitHubRateLimitedError,
  readActivePause,
  recordGitHubRefusal,
} from '../../../../src/lib/github-quota/pause-gate.js';
import { classifyGhInvocation, runGh } from '../../../../src/lib/github-quota/run-gh.js';
import { readGraphqlRateLimit, runGitHubGraphql } from '../../../../src/lib/github-graphql-run.js';

describe('runGh (PAN-4264)', () => {
  let home: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-run-gh-'));
    process.env.OVERDECK_HOME = home;
  });

  afterEach(async () => {
    await flushLedgerWrites();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('execs gh and appends an ok ledger line for the resolved caller and bucket', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: '[]' });
    const result = await runGh(['pr', 'list', '--json', 'number'], { caller: 'pr-cache', cwd: '/repo', timeout: 20_000, exec });

    expect(result).toEqual({ stdout: '[]' });
    expect(exec).toHaveBeenCalledWith(['pr', 'list', '--json', 'number'], { cwd: '/repo', timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    await flushLedgerWrites();
    const [entry] = readLedgerWindow(Date.now());
    expect(entry).toMatchObject({
      kind: 'call', caller: 'pr-cache', pool: 'user', bucket: 'graphql', cost: 1, estimated: true, outcome: 'ok',
    });
  });

  it('takes the caller from context, else records other', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: '{}' });
    await withGitHubCaller('ci-repair', () => runGh(['api', 'repos/o/r/actions/runs'], { exec }));
    await runGh(['api', 'user', '--jq', '.login'], { exec });
    await flushLedgerWrites();
    expect(readLedgerWindow(Date.now()).map((e) => [e.caller, e.bucket, e.estimated])).toEqual([
      ['ci-repair', 'rest', false],
      ['other', 'rest', false],
    ]);
  });

  it('merges onSuccess fields into the ledger line', async () => {
    const exec = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ data: { rateLimit: { cost: 3, remaining: 4990, limit: 5000, resetAt: '2026-09-27T16:00:00Z' } } }),
    });
    await runGh(['api', 'graphql', '-f', 'query=q'], { caller: 'pipeline-membership', exec, onSuccess: readGraphqlRateLimit });
    await flushLedgerWrites();
    expect(readLedgerWindow(Date.now())[0]).toMatchObject({
      bucket: 'graphql', cost: 3, estimated: false, remaining: 4990, limit: 5000, resetAt: '2026-09-27T16:00:00Z',
    });
  });

  it('throws GitHubRateLimitedError and writes a pause on rate-limit stderr', async () => {
    const failure = Object.assign(new Error('Command failed: gh api graphql'), {
      code: 1,
      stdout: '',
      stderr: 'GraphQL: API rate limit already exceeded for user ID 678719.',
    });
    const exec = vi.fn().mockRejectedValue(failure);

    const error = await runGh(['api', 'graphql', '-f', 'query=q'], { caller: 'pipeline-membership', exec })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitHubRateLimitedError);
    expect((error as GitHubRateLimitedError).cause).toBe(failure);
    expect(existsSync(join(getGitHubQuotaDir(), 'pause.json'))).toBe(true);
    expect(readActivePause()).toEqual([expect.objectContaining({ pool: 'user', bucket: 'graphql', kind: 'primary' })]);
    expect(readLedgerWindow(Date.now()).map((e) => e.outcome)).toEqual(['rate_limited']);
  });

  it('throws before exec for a non-essential caller during a pause, and still execs for an essential one', async () => {
    await recordGitHubRefusal({ pool: 'user', bucket: 'graphql', caller: 'pr-sync', refusal: { kind: 'primary' } });
    const exec = vi.fn().mockResolvedValue({ stdout: '{}' });

    await expect(runGh(['pr', 'view', '12'], { caller: 'pr-sync', exec })).rejects.toBeInstanceOf(GitHubQuotaPausedError);
    expect(exec).not.toHaveBeenCalled();

    await expect(runGh(['api', 'repos/o/r'], { caller: 'pr-sync', exec })).resolves.toEqual({ stdout: '{}' });
    await expect(runGh(['pr', 'view', '12'], { exec })).resolves.toEqual({ stdout: '{}' });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('rethrows other failures unchanged and records an error line', async () => {
    const failure = Object.assign(new Error('Command failed: gh issue view 9'), {
      code: 1,
      stdout: '{"data":{"x":1},"errors":[]}',
      stderr: 'GraphQL: Could not resolve to an Issue with the number of 9.',
    });
    const exec = vi.fn().mockRejectedValue(failure);

    await expect(runGh(['issue', 'view', '9'], { caller: 'close-out', exec })).rejects.toBe(failure);
    await flushLedgerWrites();
    expect(readLedgerWindow(Date.now()).map((e) => e.outcome)).toEqual(['error']);
    expect(readActivePause()).toEqual([]);
  });

  it('classifies gh invocations into buckets', () => {
    expect(classifyGhInvocation(['api', 'graphql', '-f', 'query=q'])).toEqual({ bucket: 'graphql', estimated: true });
    expect(classifyGhInvocation(['api', '-H', 'Accept: x', 'graphql'])).toEqual({ bucket: 'graphql', estimated: true });
    expect(classifyGhInvocation(['api', 'repos/o/r/pulls'])).toEqual({ bucket: 'rest', estimated: false });
    expect(classifyGhInvocation(['api', '--paginate', 'repos/o/r/issues'])).toEqual({ bucket: 'rest', estimated: true });
    expect(classifyGhInvocation(['issue', 'view', '1'])).toEqual({ bucket: 'graphql', estimated: true });
    expect(classifyGhInvocation(['run', 'list'])).toEqual({ bucket: 'rest', estimated: true });
  });
});

describe('runGitHubGraphql through the meter (PAN-4264)', () => {
  it('does not retry a rate-limit refusal or a pause', async () => {
    const refused = new GitHubRateLimitedError({
      pool: 'user', bucket: 'graphql', kind: 'primary', caller: 'other',
      since: new Date().toISOString(), until: new Date(Date.now() + 60_000).toISOString(),
    });
    const exec = vi.fn().mockRejectedValue(refused);
    const delay = vi.fn().mockResolvedValue(undefined);

    await expect(runGitHubGraphql('query { x }', exec, delay)).rejects.toBe(refused);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('reads the GraphQL rateLimit selection, or nothing when absent', () => {
    expect(readGraphqlRateLimit('{"data":{"rateLimit":{"cost":2,"remaining":10,"limit":5000,"resetAt":"R"}}}'))
      .toEqual({ cost: 2, estimated: false, remaining: 10, limit: 5000, resetAt: 'R' });
    expect(readGraphqlRateLimit('{"data":{"repository":{}}}')).toEqual({});
  });
});
