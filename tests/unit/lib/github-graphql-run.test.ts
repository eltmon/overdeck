import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  describeGhGraphqlFailure,
  GH_GRAPHQL_RETRY_DELAY_MS,
  runGitHubGraphql,
} from '../../../src/lib/github-graphql-run.js';

describe('describeGhGraphqlFailure', () => {
  it('renders an exit-code failure with trimmed stderr and no query text', () => {
    const error = { code: 1, killed: false, stdout: '', stderr: 'error connecting to api.github.com\n' };
    expect(describeGhGraphqlFailure(error, 1))
      .toBe('gh api graphql failed (exit 1, attempt 1): error connecting to api.github.com');
    expect(describeGhGraphqlFailure(error, 1)).not.toContain('query=');
  });

  it('renders a killed/timeout failure with "no stderr" when stderr is empty', () => {
    const error = { code: null, killed: true, signal: 'SIGTERM', stdout: '', stderr: '' };
    expect(describeGhGraphqlFailure(error, 1)).toBe('gh api graphql failed (timeout, attempt 1): no stderr');
  });

  it('truncates stderr to exactly 500 characters', () => {
    const error = { code: 1, killed: false, stdout: '', stderr: 'x'.repeat(600) };
    const detail = describeGhGraphqlFailure(error, 1).split(': ')[1]!;
    expect(detail).toHaveLength(500);
  });
});

describe('runGitHubGraphql', () => {
  it('passes the exact gh args and returns stdout on success', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: '{"data":{}}' });
    const result = await runGitHubGraphql('query { viewer { login } }', exec);
    expect(result).toBe('{"data":{}}');
    expect(exec).toHaveBeenCalledWith(['api', 'graphql', '-f', 'query=query { viewer { login } }']);
  });

  it('returns the partial envelope when stdout carries non-null data despite a rejection', async () => {
    const exec = vi.fn().mockRejectedValue({
      code: 1,
      killed: false,
      stdout: '{"data":{"repository":{}},"errors":[{"message":"partial"}]}',
      stderr: 'some warning',
    });
    const result = await runGitHubGraphql('query { x }', exec);
    expect(result).toBe('{"data":{"repository":{}},"errors":[{"message":"partial"}]}');
  });

  it('rejects with a stderr-carrying error (cause set, no query text) when stdout is not JSON', async () => {
    const originalError = { code: 1, killed: false, stdout: '', stderr: 'error connecting to api.github.com' };
    const exec = vi.fn().mockRejectedValue(originalError);
    const delay = vi.fn().mockResolvedValue(undefined);
    await expect(runGitHubGraphql('query { viewer { login } }', exec, delay)).rejects.toMatchObject({
      message: expect.stringContaining('gh api graphql failed ('),
      cause: originalError,
    });
    const rejection = await runGitHubGraphql('query { viewer { login } }', exec, delay).catch((error: Error) => error);
    expect(rejection.message).not.toContain('query=');
  });
});

describe('runGitHubGraphql retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries once after a non-JSON failure and resolves with the second stdout', async () => {
    const exec = vi.fn()
      .mockRejectedValueOnce({ code: 1, killed: false, stdout: '', stderr: 'error connecting' })
      .mockResolvedValueOnce({ stdout: '{"data":{}}' });
    const resultPromise = runGitHubGraphql('query { x }', exec);
    await vi.advanceTimersByTimeAsync(GH_GRAPHQL_RETRY_DELAY_MS);
    await expect(resultPromise).resolves.toBe('{"data":{}}');
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0]).toEqual(exec.mock.calls[1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with attempt 2 after two non-JSON failures, exec called exactly twice', async () => {
    const exec = vi.fn().mockRejectedValue({ code: 1, killed: false, stdout: '', stderr: 'error connecting' });
    const resultPromise = runGitHubGraphql('query { x }', exec);
    const assertion = expect(resultPromise).rejects.toThrow(/attempt 2/);
    await vi.advanceTimersByTimeAsync(GH_GRAPHQL_RETRY_DELAY_MS);
    await assertion;
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('rejects immediately (attempt 1, no delay) given an errors-only JSON envelope', async () => {
    const exec = vi.fn().mockRejectedValue({
      code: 1,
      killed: false,
      stdout: '{"errors":[{"message":"API rate limit exceeded"}],"data":null}',
      stderr: '',
    });
    await expect(runGitHubGraphql('query { x }', exec)).rejects.toThrow(/attempt 1/);
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
