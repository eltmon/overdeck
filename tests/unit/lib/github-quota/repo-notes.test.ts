import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APP_NOT_INSTALLED_TTL_MS,
  clearAppNotInstalled,
  isAppMarkedNotInstalled,
  markAppNotInstalled,
  readAppMissingRepos,
  resetRepoNotesForTests,
} from '../../../../src/lib/github-quota/repo-notes.js';

// PAN-5153 review: another process (pan doctor) rewriting repo-notes.json
// must reach this process without waiting out the 6-hour TTL.
describe('repo notes follow the file on disk (PAN-5153)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  function notesFile(): string {
    return join(home, 'github-quota', 'repo-notes.json');
  }

  function writeNotesFromAnotherProcess(repos: Record<string, unknown>, mtimeSec: number): void {
    mkdirSync(join(home, 'github-quota'), { recursive: true });
    writeFileSync(notesFile(), JSON.stringify({ repos }));
    utimesSync(notesFile(), mtimeSec, mtimeSec);
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-repo-notes-'));
    process.env.OVERDECK_HOME = home;
    resetRepoNotesForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('drops a note another process cleared', async () => {
    markAppNotInstalled('acme', 'web');
    expect(isAppMarkedNotInstalled('acme', 'web')).toBe(true);
    await vi.waitFor(() => expect(readAppMissingRepos().map((r) => r.repo)).toEqual(['acme/web']));

    writeNotesFromAnotherProcess({}, Math.floor(Date.now() / 1000) + 60);

    expect(isAppMarkedNotInstalled('acme', 'web')).toBe(false);
  });

  it('picks up a note another process wrote', () => {
    expect(isAppMarkedNotInstalled('acme', 'api')).toBe(false);
    const now = Date.now();
    writeNotesFromAnotherProcess({
      'acme/api': {
        appInstalled: false,
        checkedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + APP_NOT_INSTALLED_TTL_MS).toISOString(),
      },
    }, Math.floor(now / 1000) + 60);

    expect(isAppMarkedNotInstalled('acme', 'api')).toBe(true);
  });

  it('clears a note in this process and on disk', async () => {
    markAppNotInstalled('acme', 'web');
    await vi.waitFor(() => expect(readAppMissingRepos()).toHaveLength(1));
    clearAppNotInstalled('acme', 'web');
    expect(isAppMarkedNotInstalled('acme', 'web')).toBe(false);
    await vi.waitFor(() => expect(readAppMissingRepos()).toEqual([]));
  });
});
