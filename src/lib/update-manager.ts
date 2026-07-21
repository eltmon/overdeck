/** Canonical update discovery and npm installation service. */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  OVERDECK_AGENT_PROTOCOL_VERSION,
  OVERDECK_DASHBOARD_PROTOCOL_VERSION,
  type UpdateChannel,
  type UpdateInstallMode,
  type UpdateSnapshot,
} from '@overdeck/contracts';

const execFileAsync = promisify(execFile);
const NPM_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/%40overdeck%2Fcore/dist-tags';
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/eltmon/overdeck/releases';

interface ReleaseData {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
}

export function updateChannelForVersion(version: string): UpdateChannel {
  return version.includes('-canary.') ? 'canary' : 'stable';
}

function parseVersion(version: string): { core: number[]; prerelease: Array<number | string> } {
  const [coreText, prereleaseText = ''] = version.replace(/^v/, '').split('-', 2);
  return {
    core: coreText.split('.').map((part) => Number.parseInt(part, 10) || 0),
    prerelease: prereleaseText ? prereleaseText.split('.').map((part) => /^\d+$/.test(part) ? Number(part) : part) : [],
  };
}

export function isVersionNewer(candidate: string, current: string): boolean {
  if (current === 'unknown') return true;
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let index = 0; index < 3; index += 1) {
    if ((a.core[index] ?? 0) !== (b.core[index] ?? 0)) return (a.core[index] ?? 0) > (b.core[index] ?? 0);
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return b.prerelease.length > 0 && a.prerelease.length === 0;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === bv) continue;
    if (av === undefined) return false;
    if (bv === undefined) return true;
    if (typeof av === 'number' && typeof bv === 'string') return true;
    if (typeof av === 'string' && typeof bv === 'number') return false;
    return av > bv;
  }
  return false;
}

export class UpdateManager {
  private snapshot: UpdateSnapshot;
  private readonly fetchImpl: typeof fetch;
  private installPromise: Promise<void> | null = null;

  constructor(options: { currentVersion: string; installMode: UpdateInstallMode; fetchImpl?: typeof fetch }) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.snapshot = {
      phase: 'idle',
      installMode: options.installMode,
      channel: updateChannelForVersion(options.currentVersion),
      currentVersion: options.currentVersion,
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
  }

  getSnapshot(): UpdateSnapshot {
    return { ...this.snapshot };
  }

  async check(): Promise<UpdateSnapshot> {
    if (this.snapshot.phase === 'checking') return this.getSnapshot();
    this.snapshot = { ...this.snapshot, phase: 'checking', error: null };
    try {
      const [tagsResponse, releasesResponse] = await Promise.all([
        this.fetchImpl(NPM_DIST_TAGS_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }),
        this.fetchImpl(GITHUB_RELEASES_URL, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) }),
      ]);
      if (!tagsResponse.ok) throw new Error(`npm registry returned ${tagsResponse.status}`);
      if (!releasesResponse.ok) throw new Error(`GitHub Releases returned ${releasesResponse.status}`);
      const tags = await tagsResponse.json() as Record<string, string>;
      const targetVersion = tags[this.snapshot.channel === 'canary' ? 'canary' : 'latest'];
      if (!targetVersion) throw new Error(`No ${this.snapshot.channel} release is published`);
      const releases = await releasesResponse.json() as ReleaseData[];
      const release = releases.find((item) => item.tag_name === `v${targetVersion}` || item.tag_name === targetVersion);
      const available = isVersionNewer(targetVersion, this.snapshot.currentVersion);
      this.snapshot = {
        ...this.snapshot,
        phase: available ? 'available' : 'current',
        targetVersion,
        releaseName: release?.name ?? `Overdeck v${targetVersion}`,
        releaseNotes: release?.body ?? 'Release notes are not available for this release.',
        releaseUrl: release?.html_url ?? `https://github.com/eltmon/overdeck/releases/tag/v${targetVersion}`,
        publishedAt: release?.published_at ?? null,
        error: null,
        lastCheckedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.snapshot = {
        ...this.snapshot,
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
        lastCheckedAt: new Date().toISOString(),
      };
    }
    return this.getSnapshot();
  }

  install(): UpdateSnapshot {
    if (this.snapshot.installMode === 'development') {
      this.snapshot = { ...this.snapshot, phase: 'error', error: 'Development builds must be updated from the repository.' };
      return this.getSnapshot();
    }
    if (this.snapshot.phase !== 'available' || !this.snapshot.targetVersion) {
      this.snapshot = { ...this.snapshot, error: 'No update is available to install.' };
      return this.getSnapshot();
    }
    if (!this.installPromise) {
      const version = this.snapshot.targetVersion;
      this.snapshot = { ...this.snapshot, phase: 'installing', error: null };
      this.installPromise = (async () => {
        try {
          await execFileAsync('npm', ['install', '--global', `@overdeck/core@${version}`]);
          await execFileAsync('pan', ['sync']);
          this.snapshot = { ...this.snapshot, phase: 'ready' };
        } catch (error) {
          this.snapshot = { ...this.snapshot, phase: 'error', error: error instanceof Error ? error.message : String(error) };
        } finally {
          this.installPromise = null;
        }
      })();
    }
    return this.getSnapshot();
  }
}
