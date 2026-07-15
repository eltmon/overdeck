import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const handlers = new Map<string, (...args: any[]) => void>();

vi.mock('electron-updater', () => ({
  autoUpdater: {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, callback: (...args: any[]) => void) => handlers.set(event, callback)),
    autoDownload: false,
    autoInstallOnAppQuit: true,
    channel: 'latest',
  },
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getVersion: () => '1.2.3' },
}));

import { checkForUpdates, currentStatus, downloadUpdate, getUpdateStatus, initializeAutoUpdater } from '../src/updater.js';
const autoUpdater = (await import('electron-updater')).autoUpdater as any;

describe('desktop updater', () => {
  it('keeps compact desktop protocol literals aligned with shared contracts', () => {
    const contracts = readFileSync('../../packages/contracts/src/update.ts', 'utf8');
    const updater = readFileSync('src/updater.ts', 'utf8');
    for (const name of ['OVERDECK_DASHBOARD_PROTOCOL_VERSION', 'OVERDECK_AGENT_PROTOCOL_VERSION']) {
      const expected = contracts.match(new RegExp(`${name} = (\\d+)`))?.[1];
      expect(expected).toBeTruthy();
      expect(updater).toContain(`const ${name} = ${expected};`);
    }
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        tag_name: 'v1.2.4', prerelease: false, name: 'Overdeck 1.2.4', body: 'Changes', html_url: 'https://example.test/release',
        assets: [{ name: 'latest-linux.yml', browser_download_url: 'https://example.test/latest-linux.yml' }],
      }])))
      .mockResolvedValueOnce(new Response('version: 1.2.4\noverdeckDashboardProtocol: 1\noverdeckAgentProtocol: 1\n')));
    initializeAutoUpdater();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('starts with a typed desktop snapshot', () => {
    expect(currentStatus.installMode).toBe('desktop');
    expect(currentStatus.currentVersion).toBe('1.2.3');
    expect(getUpdateStatus()).toEqual(currentStatus);
  });

  it('resolves an exact generic release feed with compatible metadata', async () => {
    await checkForUpdates();
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://github.com/eltmon/overdeck/releases/download/v1.2.4',
    });
    expect(getUpdateStatus().compatibility.status).toBe('compatible');
  });

  it('registers the complete update lifecycle', () => {
    expect([...handlers.keys()]).toEqual(expect.arrayContaining([
      'checking-for-update', 'update-available', 'update-not-available', 'download-progress', 'update-downloaded', 'error',
    ]));
  });

  it('retries transient download failures with fake timers', async () => {
    vi.useFakeTimers();
    handlers.get('update-available')?.({ version: '1.2.4' });
    autoUpdater.downloadUpdate
      .mockRejectedValueOnce(new Error('temporary one'))
      .mockRejectedValueOnce(new Error('temporary two'))
      .mockResolvedValueOnce(undefined);

    const resultPromise = downloadUpdate();
    await vi.advanceTimersByTimeAsync(6_000);
    await resultPromise;
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(3);
  });
});
