import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execSyncMock = vi.fn<(cmd: string, opts?: unknown) => string | Buffer>();
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, execSync: (cmd: string, opts?: unknown) => execSyncMock(cmd, opts) };
});

import { syncPiSettingsSync } from '../sync.js';

describe('syncPiSettings — private managed Pi home', () => {
  let root: string;
  let overdeckHome: string;
  let originalOverdeckHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-pi-sync-'));
    overdeckHome = join(root, '.overdeck');
    originalOverdeckHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = overdeckHome;
    execSyncMock.mockReset();
    execSyncMock.mockReturnValue('/usr/local/bin/pi\n');
  });

  afterEach(() => {
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('creates only an Overdeck-private settings file with private skills', () => {
    const nativeSettings = join(root, '.pi', 'agent', 'settings.json');
    mkdirSync(join(root, '.pi', 'agent'), { recursive: true });
    writeFileSync(nativeSettings, '{"native":"sentinel"}\n');

    const result = syncPiSettingsSync();

    expect(result.status).toBe('created');
    expect(result.path).toBe(join(overdeckHome, 'harnesses', 'pi', 'settings.json'));
    expect(JSON.parse(readFileSync(result.path, 'utf-8')).skills).toContain(
      join(overdeckHome, 'harnesses', 'agent-skills'),
    );
    expect(readFileSync(nativeSettings, 'utf-8')).toBe('{"native":"sentinel"}\n');
  });

  it('preserves unrelated keys in the private settings file', () => {
    const settingsPath = join(overdeckHome, 'harnesses', 'pi', 'settings.json');
    mkdirSync(join(settingsPath, '..'), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', skills: ['/custom'] }));

    expect(syncPiSettingsSync().status).toBe('updated');
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(parsed.theme).toBe('dark');
    expect(parsed.skills).toEqual(['/custom', join(overdeckHome, 'harnesses', 'agent-skills')]);
  });

  it('does not create settings when Pi is not installed', () => {
    execSyncMock.mockImplementation(() => { throw new Error('not found'); });
    const result = syncPiSettingsSync();
    expect(result.status).toBe('skipped');
    expect(existsSync(result.path)).toBe(false);
  });

  it('is idempotent', () => {
    expect(syncPiSettingsSync().status).toBe('created');
    expect(syncPiSettingsSync().status).toBe('unchanged');
  });

  it('does not overwrite malformed private settings', () => {
    const settingsPath = join(overdeckHome, 'harnesses', 'pi', 'settings.json');
    mkdirSync(join(settingsPath, '..'), { recursive: true });
    writeFileSync(settingsPath, '{ malformed');
    const result = syncPiSettingsSync();
    expect(result.status).toBe('skipped');
    expect(readFileSync(settingsPath, 'utf-8')).toBe('{ malformed');
  });
});
