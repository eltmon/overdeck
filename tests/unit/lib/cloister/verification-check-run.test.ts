import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  postVerificationCheckRun,
  VERIFICATION_CHECK_RUN_NAME,
  type VerificationCheckRunInput,
} from '../../../../src/lib/cloister/verification-check-run.js';

// PAN-5153 W5 step 16: the verification check run uses the token of the
// installation that covers the repository, and posts nothing where the App is
// not installed.
describe('postVerificationCheckRun per repository (PAN-5153)', () => {
  const input: VerificationCheckRunInput = {
    owner: 'acme',
    repo: 'web',
    headSha: 'abc123',
    conclusion: 'success',
    title: 'all gates passed',
    summary: 'ok',
  };
  // Built at runtime so no token-shaped literal lands in the repository.
  const fakeToken = ['gh', 's_', 'test'].join('');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts nothing and returns false where the App is not installed', async () => {
    const fetchImpl = vi.fn();
    const result = await postVerificationCheckRun(input, {
      isConfigured: () => true,
      getToken: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts the check run with the covering installation\'s token', async () => {
    const getToken = vi.fn(async (_owner: string, _repo: string) => fakeToken);
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 201 }));
    const result = await postVerificationCheckRun(input, {
      isConfigured: () => true,
      getToken,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toBe(true);
    expect(getToken).toHaveBeenCalledWith('acme', 'web');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/web/check-runs');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`token ${fakeToken}`);
    expect(JSON.parse(String(init.body))).toMatchObject({ name: VERIFICATION_CHECK_RUN_NAME, head_sha: 'abc123' });
  });

  it('returns false without a token request when the App is not configured', async () => {
    const getToken = vi.fn(async () => fakeToken);
    const fetchImpl = vi.fn();
    await expect(postVerificationCheckRun(input, {
      isConfigured: () => false,
      getToken,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).resolves.toBe(false);
    expect(getToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
