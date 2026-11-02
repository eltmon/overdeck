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

import { ensureDurableRuntime } from './anywhere/connect-runtime.js';
import { panCliInvocation } from './pan-cli-invocation.js';

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

/** The side effects of an Overdeck install; injectable for tests (PAN-4722). */
export interface UpdateInstallDeps {
  /** Runs a command; rejects on a non-zero exit. */
  execFile: (file: string, args: readonly string[]) => Promise<void>;
  ensureDurableRuntime: (overdeckHome: string, version: string) => Promise<{ root: string; installed: boolean }>;
}

const defaultInstallDeps: UpdateInstallDeps = {
  execFile: async (file, args) => {
    await execFileAsync(file, [...args]);
  },
  ensureDurableRuntime: (overdeckHome, version) => ensureDurableRuntime(overdeckHome, version),
};

/**
 * Installs @overdeck/core@<version> where the running copy lives: the
 * `pan connect` runtime under `runtimeHome` (PAN-4722), else the global
 * npm prefix.
 */
export async function installOverdeckPackage(
  version: string,
  runtimeHome: string | null,
  deps: UpdateInstallDeps = defaultInstallDeps,
): Promise<void> {
  if (runtimeHome) {
    await deps.ensureDurableRuntime(runtimeHome, version);
    return;
  }
  await deps.execFile('npm', ['install', '--global', `@overdeck/core@${version}`]);
}

export class UpdateManager {
  private snapshot: UpdateSnapshot;
  private readonly fetchImpl: typeof fetch;
  private readonly runtimeHome: string | null;
  private readonly installDeps: UpdateInstallDeps;
  private installPromise: Promise<void> | null = null;

  constructor(options: {
    currentVersion: string;
    installMode: UpdateInstallMode;
    fetchImpl?: typeof fetch;
    /** OVERDECK_HOME whose `pan connect` runtime this process runs from; install() updates that runtime (PAN-4722). */
    runtimeHome?: string | null;
    installDeps?: Partial<UpdateInstallDeps>;
  }) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.runtimeHome = options.runtimeHome ?? null;
    this.installDeps = { ...defaultInstallDeps, ...options.installDeps };
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
          await installOverdeckPackage(version, this.runtimeHome, this.installDeps);
          this.snapshot = { ...this.snapshot, phase: 'ready', error: await this.syncAfterInstall(version) };
        } catch (error) {
          this.snapshot = { ...this.snapshot, phase: 'error', error: error instanceof Error ? error.message : String(error) };
        } finally {
          this.installPromise = null;
        }
      })();
    }
    return this.getSnapshot();
  }

  /** D-5: the files are already replaced, so a sync failure is reported, never fatal. Null on success. */
  private async syncAfterInstall(version: string): Promise<string | null> {
    const sync = panCliInvocation(['sync']);
    try {
      await this.installDeps.execFile(sync.command, sync.args);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[update] pan sync after install failed:', error);
      return `Installed ${version}, but pan sync failed: ${message}. Run pan sync on this machine.`;
    }
  }
}
