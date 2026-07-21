import { spawn, type ChildProcess } from 'node:child_process';
import {
  ensureOpenKnowledge,
  startReadOnlyOpenKnowledgeServer,
  type EnsureOpenKnowledgeResult,
  type StartOpenKnowledgeServerResult,
} from '../../../lib/installers/open-knowledge.js';
import { resolveKnowledgeBundleRoot } from '../../../lib/memory/injection.js';
import { loadProjectsConfigSync } from '../../../lib/projects.js';

export interface KnowledgeViewerStatus {
  projectKey: string;
  bundleConfigured: boolean;
  installed: boolean;
  starting: boolean;
  running: boolean;
  bundlePath?: string;
  port?: number;
  apiPort?: number;
  url?: string;
  proxyUrl?: string;
  embeddable?: boolean;
  message?: string;
}

export interface KnowledgeViewerService {
  getStatus(projectKey: string): Promise<KnowledgeViewerStatus>;
  getOrStartViewer(projectKey: string): Promise<KnowledgeViewerStatus>;
  invalidateInstallationCache(): void;
  stopAll(): Promise<void>;
}

export interface KnowledgeViewerDependencies {
  resolveBundle?: (projectKey: string) => Promise<string | null>;
  ensure?: (options: { autoInstall: false }) => Promise<EnsureOpenKnowledgeResult>;
  start?: (bundlePath: string, options: { openBrowser: false }) => Promise<StartOpenKnowledgeServerResult>;
  stop?: (bundlePath: string) => Promise<void>;
  fetchImpl?: typeof fetch;
}

interface ViewerEntry {
  bundlePath: string;
  runtimeBundlePath: string;
  process: ChildProcess | null;
  owned: boolean;
  port: number;
  apiPort: number;
  url: string;
  exited: boolean;
}

interface ViewerProbe {
  healthy: boolean;
  embeddable: boolean;
}

export function createKnowledgeViewerService(
  dependencies: KnowledgeViewerDependencies = {},
): KnowledgeViewerService {
  const resolveBundle = dependencies.resolveBundle ?? resolveBundleForProject;
  const ensure = dependencies.ensure ?? ((options) => ensureOpenKnowledge(options));
  const start = dependencies.start ?? ((bundlePath, options) => startReadOnlyOpenKnowledgeServer(bundlePath, options));
  const stop = dependencies.stop ?? stopOpenKnowledgeWithSpawn;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const entries = new Map<string, ViewerEntry>();
  const starts = new Map<string, Promise<KnowledgeViewerStatus>>();
  let installedCache: EnsureOpenKnowledgeResult | null = null;

  async function getStatus(projectKey: string): Promise<KnowledgeViewerStatus> {
    const bundlePath = await resolveBundle(projectKey);
    if (!bundlePath) {
      return unavailableStatus(projectKey, starts.has(projectKey), 'No OKF bundle is configured. Run `/okf init` first.');
    }

    let installed = true;
    let installMessage: string | undefined;
    try {
      installedCache ??= await ensure({ autoInstall: false });
    } catch (error) {
      installed = false;
      installMessage = errorMessage(error);
    }

    const entry = entries.get(projectKey);
    if (entry && isProcessLive(entry)) {
      const probe = await probeViewer(entry.url, fetchImpl);
      if (probe.healthy) {
        return {
          projectKey,
          bundleConfigured: true,
          installed,
          starting: starts.has(projectKey),
          running: true,
          bundlePath,
          port: entry.port,
          apiPort: entry.apiPort,
          url: entry.url,
          embeddable: probe.embeddable,
          ...(installMessage ? { message: installMessage } : {}),
        };
      }
    }
    if (entry) await stopEntry(projectKey, entry);

    return {
      projectKey,
      bundleConfigured: true,
      installed,
      starting: starts.has(projectKey),
      running: false,
      bundlePath,
      ...(installMessage ? { message: installMessage } : {}),
    };
  }

  function getOrStartViewer(projectKey: string): Promise<KnowledgeViewerStatus> {
    const inFlight = starts.get(projectKey);
    if (inFlight) return inFlight;

    const promise = startViewer(projectKey).finally(() => {
      if (starts.get(projectKey) === promise) starts.delete(projectKey);
    });
    starts.set(projectKey, promise);
    return promise;
  }

  async function startViewer(projectKey: string): Promise<KnowledgeViewerStatus> {
    const status = await getStatus(projectKey);
    if (!status.bundleConfigured || !status.installed || status.running) return status;

    let started: StartOpenKnowledgeServerResult;
    try {
      started = await start(status.bundlePath!, { openBrowser: false });
    } catch (error) {
      installedCache = null;
      throw error;
    }
    const entry: ViewerEntry = {
      bundlePath: status.bundlePath!,
      runtimeBundlePath: started.runtimeBundlePath,
      process: started.process,
      owned: started.owned,
      port: started.port,
      apiPort: started.apiPort,
      url: started.url,
      exited: false,
    };
    entries.set(projectKey, entry);
    started.process?.once('exit', () => {
      entry.exited = true;
      if (entries.get(projectKey) === entry) entries.delete(projectKey);
    });

    const probe = await probeViewer(started.url, fetchImpl);
    if (!probe.healthy) {
      await stopEntry(projectKey, entry);
      throw new Error(`open-knowledge viewer did not remain healthy at ${started.url}`);
    }

    return {
      projectKey,
      bundleConfigured: true,
      installed: true,
      starting: false,
      running: true,
      bundlePath: entry.bundlePath,
      port: entry.port,
      apiPort: entry.apiPort,
      url: entry.url,
      embeddable: probe.embeddable,
    };
  }

  async function stopEntry(projectKey: string, entry: ViewerEntry): Promise<void> {
    if (entries.get(projectKey) === entry) entries.delete(projectKey);
    if (!entry.owned) return;
    try {
      await stop(entry.runtimeBundlePath);
    } catch {
      // The tracked child is still ours to terminate when the `ok stop` helper fails.
    }
    if (isProcessLive(entry)) entry.process?.kill('SIGTERM');
  }

  function invalidateInstallationCache(): void {
    installedCache = null;
  }

  async function stopAll(): Promise<void> {
    await Promise.allSettled(starts.values());
    starts.clear();
    const active = [...entries.entries()];
    entries.clear();
    await Promise.all(active.map(async ([projectKey, entry]) => stopEntry(projectKey, entry)));
  }

  return { getStatus, getOrStartViewer, invalidateInstallationCache, stopAll };
}

async function resolveBundleForProject(projectKey: string): Promise<string | null> {
  const project = loadProjectsConfigSync().projects[projectKey];
  if (!project) return null;
  return resolveKnowledgeBundleRoot({ projectPath: project.path });
}

function unavailableStatus(projectKey: string, starting: boolean, message: string): KnowledgeViewerStatus {
  return {
    projectKey,
    bundleConfigured: false,
    installed: false,
    starting,
    running: false,
    message,
  };
}

function isProcessLive(entry: ViewerEntry): boolean {
  return entry.process === null || (!entry.exited && entry.process.exitCode == null);
}

async function probeViewer(url: string, fetchImpl: typeof fetch): Promise<ViewerProbe> {
  try {
    const response = await fetchImpl(url, { method: 'GET' });
    return {
      healthy: response.ok,
      embeddable: response.ok && responseAllowsEmbedding(response.headers),
    };
  } catch {
    return { healthy: false, embeddable: false };
  }
}

function responseAllowsEmbedding(headers: Headers): boolean {
  const frameOptions = headers.get('x-frame-options')?.trim().toLowerCase();
  if (frameOptions === 'deny' || frameOptions === 'sameorigin') return false;
  const csp = headers.get('content-security-policy')?.toLowerCase() ?? '';
  const frameAncestors = csp.match(/(?:^|;)\s*frame-ancestors\s+([^;]+)/)?.[1]?.trim();
  if (!frameAncestors) return true;
  return frameAncestors !== "'none'" && frameAncestors !== "'self'";
}

async function stopOpenKnowledgeWithSpawn(bundlePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ok', ['--cwd', bundlePath, 'stop'], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ok stop exited with code ${code}`));
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const defaultKnowledgeViewerService = createKnowledgeViewerService();

export const getKnowledgeViewerStatus = (projectKey: string): Promise<KnowledgeViewerStatus> =>
  defaultKnowledgeViewerService.getStatus(projectKey);

export const getOrStartViewer = (projectKey: string): Promise<KnowledgeViewerStatus> =>
  defaultKnowledgeViewerService.getOrStartViewer(projectKey);

export const invalidateKnowledgeViewerInstallationCache = (): void =>
  defaultKnowledgeViewerService.invalidateInstallationCache();

export const stopAllKnowledgeViewers = (): Promise<void> =>
  defaultKnowledgeViewerService.stopAll();
