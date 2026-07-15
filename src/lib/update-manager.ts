/** Canonical read/write door for browser and CLI update discovery and installation. */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  OVERDECK_AGENT_PROTOCOL_VERSION,
  OVERDECK_DASHBOARD_PROTOCOL_VERSION,
  type UpdateChannel,
  type UpdateInstallMode,
  type UpdateSnapshot,
} from '@overdeck/contracts';

const defaultExecFile = promisify(execFile);
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NPM_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/%40overdeck%2Fcore/dist-tags';
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/eltmon/overdeck/releases';
const USER_AGENT = 'Overdeck-Updater/1 (+https://overdeck.ai)';
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

interface ReleaseData {
  tag_name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  overdeckDashboardProtocol?: number;
  overdeckAgentProtocol?: number;
}

type ExecFileFn = (file: string, args: readonly string[]) => Promise<unknown>;

export function updateChannelForVersion(version: string): UpdateChannel {
  return version.includes('-canary.') ? 'canary' : 'stable';
}

function parseVersion(version: string): { core: number[]; prerelease: Array<number | string> } {
  const [coreText, prereleaseText = ''] = version.replace(/^v/, '').split('-', 2);
  return { core: coreText.split('.').map(Number), prerelease: prereleaseText ? prereleaseText.split('.').map((part) => /^\d+$/.test(part) ? Number(part) : part) : [] };
}

export function isVersionNewer(candidate: string, current: string): boolean {
  if (current === 'unknown') return true;
  const a = parseVersion(candidate); const b = parseVersion(current);
  for (let i = 0; i < 3; i += 1) if (a.core[i] !== b.core[i]) return (a.core[i] ?? 0) > (b.core[i] ?? 0);
  if (!a.prerelease.length || !b.prerelease.length) return b.prerelease.length > a.prerelease.length;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    const av = a.prerelease[i]; const bv = b.prerelease[i];
    if (av === bv) continue;
    if (av === undefined) return false; if (bv === undefined) return true;
    if (typeof av === 'number' && typeof bv === 'string') return true;
    if (typeof av === 'string' && typeof bv === 'number') return false;
    return av > bv;
  }
  return false;
}

export class UpdateManager {
  private snapshot: UpdateSnapshot;
  private readonly fetchImpl: typeof fetch;
  private readonly execFileImpl: ExecFileFn;
  private readonly now: () => number;
  private installPromise: Promise<void> | null = null;
  private successfulCheckAt = 0;
  private readonly listeners = new Set<(snapshot: UpdateSnapshot) => void>();

  constructor(options: { currentVersion: string; installMode: UpdateInstallMode; fetchImpl?: typeof fetch; execFileImpl?: ExecFileFn; now?: () => number }) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.execFileImpl = options.execFileImpl ?? ((file, args) => defaultExecFile(file, [...args]));
    this.now = options.now ?? Date.now;
    this.snapshot = {
      phase: 'idle', installMode: options.installMode, channel: updateChannelForVersion(options.currentVersion), currentVersion: options.currentVersion,
      targetVersion: null, releaseNotes: null, releaseUrl: null, releaseDate: null, progress: null, lastCheckedAt: null, error: null,
      compatibility: { status: 'unknown', currentDashboardProtocol: OVERDECK_DASHBOARD_PROTOCOL_VERSION, targetDashboardProtocol: null, currentAgentProtocol: OVERDECK_AGENT_PROTOCOL_VERSION, targetAgentProtocol: null },
    };
  }

  getSnapshot(): UpdateSnapshot { return structuredClone(this.snapshot); }
  subscribe(listener: (snapshot: UpdateSnapshot) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private publish(patch: Partial<UpdateSnapshot>): void { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(this.getSnapshot()); }

  async check(options: { forceRefresh?: boolean } = {}): Promise<UpdateSnapshot> {
    if (this.snapshot.phase === 'checking') return this.getSnapshot();
    if (!options.forceRefresh && this.successfulCheckAt && this.now() - this.successfulCheckAt < CACHE_TTL_MS) return this.getSnapshot();
    this.publish({ phase: 'checking', error: null });
    try {
      const request = { headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) };
      const [tagsResponse, releasesResponse] = await Promise.all([this.fetchImpl(NPM_DIST_TAGS_URL, request), this.fetchImpl(GITHUB_RELEASES_URL, request)]);
      if (!tagsResponse.ok) throw new Error(`npm registry returned ${tagsResponse.status}`);
      if (!releasesResponse.ok) throw new Error(`GitHub Releases returned ${releasesResponse.status}`);
      const tags = await tagsResponse.json() as Record<string, string>;
      const targetVersion = tags[this.snapshot.channel === 'canary' ? 'canary' : 'latest'];
      if (!targetVersion || !SEMVER.test(targetVersion)) throw new Error(`No valid ${this.snapshot.channel} release is published`);
      const releases = await releasesResponse.json() as ReleaseData[];
      const release = releases.find((item) => !item.draft && item.tag_name === `v${targetVersion}`);
      const dashboard = release?.overdeckDashboardProtocol ?? null;
      const agent = release?.overdeckAgentProtocol ?? null;
      const status = dashboard === OVERDECK_DASHBOARD_PROTOCOL_VERSION && agent === OVERDECK_AGENT_PROTOCOL_VERSION ? 'compatible' : 'unknown';
      this.successfulCheckAt = this.now();
      this.publish({
        phase: isVersionNewer(targetVersion, this.snapshot.currentVersion) ? 'available' : 'current', targetVersion,
        releaseNotes: release?.body ?? null, releaseUrl: release?.html_url ?? `https://github.com/eltmon/overdeck/releases/tag/v${targetVersion}`,
        releaseDate: release?.published_at ?? null, lastCheckedAt: new Date(this.now()).toISOString(), error: null,
        compatibility: { ...this.snapshot.compatibility, status, targetDashboardProtocol: dashboard, targetAgentProtocol: agent },
      });
    } catch (error) {
      this.publish({ phase: 'error', lastCheckedAt: new Date(this.now()).toISOString(), error: { code: 'UPDATE_CHECK_FAILED', message: error instanceof Error ? error.message : String(error), retryable: true } });
    }
    return this.getSnapshot();
  }

  install(options: { force?: boolean } = {}): UpdateSnapshot {
    if (this.snapshot.installMode === 'development') { this.publish({ phase: 'error', error: { code: 'DEVELOPMENT_CHECK_ONLY', message: 'Development builds must be updated from the repository.', retryable: false } }); return this.getSnapshot(); }
    if ((!options.force && this.snapshot.phase !== 'available') || !this.snapshot.targetVersion) { this.publish({ error: { code: 'NO_UPDATE', message: 'No update is available to install.', retryable: false } }); return this.getSnapshot(); }
    if (this.installPromise) return this.getSnapshot();
    const version = this.snapshot.targetVersion;
    this.publish({ phase: 'installing', error: null });
    this.installPromise = (async () => {
      try {
        await this.execFileImpl('npm', ['install', '--global', `@overdeck/core@${version}`]);
        await this.execFileImpl('pan', ['sync']);
        this.publish({ phase: 'ready' });
      } catch (error) {
        this.publish({ phase: 'error', error: { code: 'INSTALL_FAILED', message: error instanceof Error ? error.message : String(error), retryable: true } });
      } finally { this.installPromise = null; }
    })();
    return this.getSnapshot();
  }

  async waitForInstall(): Promise<UpdateSnapshot> {
    await this.installPromise;
    return this.getSnapshot();
  }
}
