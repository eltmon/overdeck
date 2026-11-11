import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getInstallationAccessTokenMock } = vi.hoisted(() => ({
  getInstallationAccessTokenMock: vi.fn(async (id?: string) => (id ? `token-${id}` : 'token-home')),
}));

vi.mock('../../../src/lib/github-app-auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/github-app-auth.js')>();
  return { ...actual, getInstallationAccessToken: getInstallationAccessTokenMock };
});

import {
  APP_INSTALLATION_TTL_MS,
  appCoversRepo,
  getRepoInstallationToken,
  repoFromApiPath,
  resetRepoInstallationCache,
  resolveRepoInstallationId,
  type RepoInstallationDeps,
} from '../../../src/lib/github-app-installations.js';
import {
  clearAppNotInstalled,
  readAppMissingRepos,
  resetRepoNotesForTests,
} from '../../../src/lib/github-quota/repo-notes.js';

// PAN-5153 W2: which App installation covers owner/repo.
describe('repo installation lookup (PAN-5153)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;
  const fetchImpl = vi.fn();

  function deps(overrides: Partial<RepoInstallationDeps> = {}): RepoInstallationDeps {
    return {
      isConfigured: () => true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadConfig: () => ({ appId: '1', installationId: '111', privateKey: 'k' }),
      makeJwt: () => 'jwt',
      ...overrides,
    };
  }

  function respondWith(status: number, body: unknown = {}): void {
    fetchImpl.mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 11, 15, 0));
    home = mkdtempSync(join(tmpdir(), 'pan-app-installations-'));
    process.env.OVERDECK_HOME = home;
    resetRepoNotesForTests();
    resetRepoInstallationCache();
    fetchImpl.mockReset();
    getInstallationAccessTokenMock.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('parses the repository out of /repos/ paths only', () => {
    expect(repoFromApiPath('/repos/a/b/pulls/1')).toEqual({ owner: 'a', repo: 'b' });
    expect(repoFromApiPath('/rate_limit')).toBeNull();
    expect(repoFromApiPath('/app')).toBeNull();
  });

  it('requests the repository installation with the App JWT', async () => {
    respondWith(200, { id: 222 });
    await resolveRepoInstallationId('a', 'b', deps());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/a/b/installation');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer jwt',
      Accept: 'application/vnd.github+json',
      'User-Agent': 'overdeck',
    });
  });

  it('caches a 200 for the TTL and shares one request between concurrent callers', async () => {
    respondWith(200, { id: 222 });
    const [first, second] = await Promise.all([
      resolveRepoInstallationId('a', 'b', deps()),
      resolveRepoInstallationId('a', 'b', deps()),
    ]);
    expect(first).toBe('222');
    expect(second).toBe('222');
    await expect(resolveRepoInstallationId('A', 'B', deps())).resolves.toBe('222');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(APP_INSTALLATION_TTL_MS + 1);
    await expect(resolveRepoInstallationId('a', 'b', deps())).resolves.toBe('222');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('marks a 404 in repo notes and does not ask again', async () => {
    respondWith(404, { message: 'Not Found' });
    await expect(appCoversRepo('a', 'b', deps())).resolves.toBe(false);
    await expect(appCoversRepo('a', 'b', deps())).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(readAppMissingRepos().map((r) => r.repo)).toEqual(['a/b']));
  });

  it('asks again after clearAppNotInstalled', async () => {
    respondWith(404, { message: 'Not Found' });
    await expect(resolveRepoInstallationId('a', 'b', deps())).resolves.toBeNull();
    clearAppNotInstalled('a', 'b');
    respondWith(200, { id: 222 });
    await expect(resolveRepoInstallationId('a', 'b', deps())).resolves.toBe('222');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('treats a 500 as a failure: resolve rejects, coverage is assumed, the home token is used', async () => {
    respondWith(500, { message: 'boom' });
    await expect(resolveRepoInstallationId('a', 'b', deps())).rejects.toThrow(
      'GitHub App installation lookup for a/b failed: 500',
    );
    await expect(appCoversRepo('a', 'b', deps())).resolves.toBe(true);
    await expect(getRepoInstallationToken('a', 'b', deps())).resolves.toBe('token-home');
    expect(getInstallationAccessTokenMock).toHaveBeenCalledWith();
    // A rejected lookup is not cached: every call above asked again.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('mints for the covering installation and returns null where the App is not installed', async () => {
    respondWith(200, { id: 222 });
    await expect(getRepoInstallationToken('a', 'b', deps())).resolves.toBe('token-222');
    respondWith(404, { message: 'Not Found' });
    await expect(getRepoInstallationToken('c', 'd', deps())).resolves.toBeNull();
  });

  it('does nothing when the App is not configured', async () => {
    respondWith(200, { id: 222 });
    const off = deps({ isConfigured: () => false });
    await expect(appCoversRepo('a', 'b', off)).resolves.toBe(false);
    await expect(getRepoInstallationToken('a', 'b', off)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getInstallationAccessTokenMock).not.toHaveBeenCalled();
  });
});
