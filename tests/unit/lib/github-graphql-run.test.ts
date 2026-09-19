import { describe, expect, it, vi } from 'vitest';

import {
  describeGhGraphqlFailure,
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
    await expect(runGitHubGraphql('query { viewer { login } }', exec)).rejects.toMatchObject({
      message: expect.stringContaining('gh api graphql failed ('),
      cause: originalError,
    });
    const rejection = await runGitHubGraphql('query { viewer { login } }', exec).catch((error: Error) => error);
    expect(rejection.message).not.toContain('query=');
  });
});
