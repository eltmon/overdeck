/** Native desktop updater backed by electron-updater and exact GitHub releases. */

import { app, BrowserWindow } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import type { UpdateChannel, UpdateSnapshot } from '@overdeck/contracts';

// Keep the Electron entrypoint small: importing the contracts runtime would
// bundle every schema and Effect dependency. The release-manifest verifier
// guards these literals against packages/contracts/src/update.ts.
const OVERDECK_DASHBOARD_PROTOCOL_VERSION = 1;
const OVERDECK_AGENT_PROTOCOL_VERSION = 1;

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const DOWNLOAD_RETRY_MS = [0, 1_000, 4_000] as const;
const RELEASES_URL = 'https://api.github.com/repos/eltmon/overdeck/releases';

let checkIntervalId: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let channel: UpdateChannel = 'stable';

export let currentStatus: UpdateSnapshot = {
  phase: 'idle',
  installMode: 'desktop',
  channel: 'stable',
  currentVersion: app.getVersion(),
  targetVersion: null,
  releaseName: null,
  releaseNotes: null,
  releaseUrl: null,
  publishedAt: null,
  progressPercent: null,
  error: null,
  lastCheckedAt: null,
  compatibility: 'unknown',
  currentDashboardProtocol: OVERDECK_DASHBOARD_PROTOCOL_VERSION,
  currentAgentProtocol: OVERDECK_AGENT_PROTOCOL_VERSION,
  targetDashboardProtocol: null,
  targetAgentProtocol: null,
};

type UpdateStatusCallback = (status: UpdateSnapshot) => void;
const statusCallbacks: UpdateStatusCallback[] = [];

export function onUpdateStatusChange(callback: UpdateStatusCallback): () => void {
  statusCallbacks.push(callback);
  return () => {
    const index = statusCallbacks.indexOf(callback);
    if (index >= 0) statusCallbacks.splice(index, 1);
  };
}

function publish(patch: Partial<UpdateSnapshot>): void {
  currentStatus = { ...currentStatus, ...patch };
  for (const callback of statusCallbacks) callback(currentStatus);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update-status', currentStatus);
  }
}

function manifestName(): string {
  const prefix = channel === 'canary' ? 'beta' : 'latest';
  if (process.platform === 'darwin') return `${prefix}-mac.yml`;
  if (process.platform === 'linux') return `${prefix}-linux.yml`;
  return `${prefix}.yml`;
}

async function configureExactReleaseFeed(): Promise<void> {
  const response = await fetch(RELEASES_URL, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`GitHub Releases returned ${response.status}`);
  const releases = await response.json() as Array<{
    tag_name: string;
    name?: string;
    body?: string;
    html_url?: string;
    published_at?: string;
    prerelease?: boolean;
    assets?: Array<{ name: string; browser_download_url: string }>;
  }>;
  const release = releases.find((item) => channel === 'canary' ? item.prerelease : !item.prerelease);
  if (!release) throw new Error(`No ${channel} desktop release is published`);
  const manifest = release.assets?.find((asset) => asset.name === manifestName());
  if (!manifest) throw new Error(`${release.tag_name} is missing ${manifestName()}`);

  const manifestResponse = await fetch(manifest.browser_download_url, { signal: AbortSignal.timeout(10_000) });
  if (!manifestResponse.ok) throw new Error(`Update manifest returned ${manifestResponse.status}`);
  const manifestText = await manifestResponse.text();
  const dashboardProtocol = Number(manifestText.match(/^overdeckDashboardProtocol:\s*(\d+)/m)?.[1]) || null;
  const agentProtocol = Number(manifestText.match(/^overdeckAgentProtocol:\s*(\d+)/m)?.[1]) || null;

  publish({
    releaseName: release.name ?? `Overdeck ${release.tag_name}`,
    releaseNotes: release.body ?? 'Release notes are not available for this release.',
    releaseUrl: release.html_url ?? null,
    publishedAt: release.published_at ?? null,
    targetDashboardProtocol: dashboardProtocol,
    targetAgentProtocol: agentProtocol,
    compatibility: dashboardProtocol === OVERDECK_DASHBOARD_PROTOCOL_VERSION && agentProtocol === OVERDECK_AGENT_PROTOCOL_VERSION ? 'compatible' : 'unknown',
  });
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: `https://github.com/eltmon/overdeck/releases/download/${release.tag_name}`,
  });
  autoUpdater.channel = channel === 'canary' ? 'beta' : 'latest';
}

export function initializeAutoUpdater(requestedChannel: string = 'latest'): void {
  if (initialized) return;
  initialized = true;
  channel = requestedChannel === 'canary' || requestedChannel === 'beta' ? 'canary' : 'stable';
  publish({ channel });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => publish({ phase: 'checking', error: null }));
  autoUpdater.on('update-available', (info: UpdateInfo) => publish({
    phase: 'available', targetVersion: info.version, progressPercent: null, error: null, lastCheckedAt: new Date().toISOString(),
  }));
  autoUpdater.on('update-not-available', (info: UpdateInfo) => publish({
    phase: 'current', targetVersion: info.version, progressPercent: null, error: null, lastCheckedAt: new Date().toISOString(),
  }));
  autoUpdater.on('download-progress', (progress) => publish({
    phase: 'downloading', progressPercent: Math.round(progress.percent * 10) / 10,
  }));
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => publish({
    phase: 'ready', targetVersion: info.version, progressPercent: 100, error: null,
  }));
  autoUpdater.on('error', (error: Error) => publish({ phase: 'error', error: error.message }));

  setTimeout(() => { void checkForUpdates(); }, 5_000);
  startPeriodicChecks();
}

export function startPeriodicChecks(): void {
  checkIntervalId ??= setInterval(() => { void checkForUpdates(); }, FOUR_HOURS_MS);
}

export function stopPeriodicChecks(): void {
  if (checkIntervalId) clearInterval(checkIntervalId);
  checkIntervalId = null;
}

export async function checkForUpdates(): Promise<UpdateSnapshot> {
  if (currentStatus.phase === 'checking') return getUpdateStatus();
  publish({ phase: 'checking', error: null });
  try {
    await configureExactReleaseFeed();
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publish({ phase: 'error', error: error instanceof Error ? error.message : String(error), lastCheckedAt: new Date().toISOString() });
  }
  return getUpdateStatus();
}

export async function downloadUpdate(): Promise<UpdateSnapshot> {
  if (currentStatus.phase !== 'available') return getUpdateStatus();
  for (let attempt = 0; attempt < DOWNLOAD_RETRY_MS.length; attempt += 1) {
    const delay = DOWNLOAD_RETRY_MS[attempt] ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      publish({ phase: 'downloading', error: null, progressPercent: 0 });
      await autoUpdater.downloadUpdate();
      return getUpdateStatus();
    } catch (error) {
      if (attempt === DOWNLOAD_RETRY_MS.length - 1) {
        publish({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return getUpdateStatus();
}

export function quitAndInstall(): void {
  if (currentStatus.phase === 'ready') autoUpdater.quitAndInstall(false, true);
}

export function getUpdateStatus(): UpdateSnapshot {
  return { ...currentStatus };
}
