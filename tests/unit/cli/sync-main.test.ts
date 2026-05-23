/**
 * Tests for pan sync-main CLI command (PAN-242)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config to return a predictable API URL
vi.mock('../../../src/lib/config.js', () => ({
  getDashboardApiUrl: vi.fn(() => 'http://localhost:3011'),
  getDashboardApiUrlSync: vi.fn(() => 'http://localhost:3011'),
}));

// Mock ora so spinner.succeed/fail route through console.log/error (no TTY writes)
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn((msg: string) => { console.log(msg); }),
    fail: vi.fn((msg: string) => { console.error(msg); }),
    stop: vi.fn().mockReturnThis(),
  })),
}));

// Import after mocks
import { syncMainCommand } from '../../../src/cli/commands/sync-main.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(status: number, body: object) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('syncMainCommand', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('calls POST /api/issues/:issueId/sync-main with uppercase issueId', async () => {
    const fetchMock = mockFetch(200, { success: true, alreadyUpToDate: true, message: 'Already up to date with main' });

    await syncMainCommand('pan-242');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3011/api/issues/PAN-242/sync-main',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reports "already up to date" when server returns alreadyUpToDate: true', async () => {
    mockFetch(200, { success: true, alreadyUpToDate: true });

    await syncMainCommand('PAN-242');

    expect(exitSpy).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toMatch(/already up to date/i);
  });

  it('reports commit count and changed files on successful sync', async () => {
    mockFetch(200, {
      success: true,
      commitCount: 3,
      changedFiles: ['src/auth.ts', 'src/config.ts', 'README.md'],
      message: 'Synced 3 commit(s) from main',
    });

    await syncMainCommand('PAN-242');

    expect(exitSpy).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toMatch(/synced 3 commit/i);
    expect(output).toMatch(/src\/auth\.ts/);
  });

  it('truncates changed files list when more than 10 files', async () => {
    const changedFiles = Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`);
    mockFetch(200, { success: true, commitCount: 1, changedFiles, message: 'Synced 1 commit(s) from main' });

    await syncMainCommand('PAN-242');

    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toMatch(/5 more/);
  });

  it('exits with code 1 and prints error on HTTP error response', async () => {
    mockFetch(400, { success: false, error: 'Workspace has uncommitted changes. Commit or stash them before syncing with main.' });

    await syncMainCommand('PAN-242');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errOutput = errorSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(errOutput).toMatch(/uncommitted changes/i);
  });

  it('prints conflict files when returned in error response', async () => {
    mockFetch(500, {
      success: false,
      error: 'Merge agent could not resolve conflicts',
      conflictFiles: ['src/foo.ts', 'src/bar.ts'],
    });

    await syncMainCommand('PAN-242');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errOutput = errorSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(errOutput).toMatch(/src\/foo\.ts/);
    expect(errOutput).toMatch(/src\/bar\.ts/);
  });

  it('exits with code 1 and prints dashboard hint on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await syncMainCommand('PAN-242');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errOutput = errorSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(errOutput).toMatch(/pan up/i);
  });
});
