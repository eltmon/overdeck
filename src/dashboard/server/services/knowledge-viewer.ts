import { spawn, type ChildProcess } from 'node:child_process';
import {
  ensureOpenKnowledge,
  OpenKnowledgeError,
  startOpenKnowledgeServer,
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
  message?: string;
}

export interface KnowledgeViewerService {
  getStatus(projectKey: string): Promise<KnowledgeViewerStatus>;
  getOrStartViewer(projectKey: string): Promise<KnowledgeViewerStatus>;
  stopAll(): Promise<void>;
}

export interface KnowledgeViewerDependencies {
  resolveBundle?: (projectKey: string) => Promise<string | null>;
  ensure?: (options: { autoInstall: false }) => Promise<EnsureOpenKnowledgeResult>;
  start?: (bundlePath: string, options: { openBrowser: false }) => Promise<StartOpenKnowledgeServerResult>;
  stop?: (bundlePath: string) => Promise<void>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  maxHealthAttempts?: number;
}

interface ViewerEntry {
  bundlePath: string;
  process: ChildProcess;
  port: number;
  apiPort: number;
  url: string;
  exited: boolean;
}

const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_HEALTH_ATTEMPTS = 40;

export function createKnowledgeViewerService(
  dependencies: KnowledgeViewerDependencies = {},
): KnowledgeViewerService {
  const resolveBundle = dependencies.resolveBundle ?? resolveBundleForProject;
  const ensure = dependencies.ensure ?? ((options) => ensureOpenKnowledge(options));
  const start = dependencies.start ?? ((bundlePath, options) => startOpenKnowledgeServer(bundlePath, options));
  const stop = dependencies.stop ?? stopOpenKnowledgeWithSpawn;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const sleep = dependencies.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retryDelayMs = dependencies.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const maxHealthAttempts = dependencies.maxHealthAttempts ?? DEFAULT_MAX_HEALTH_ATTEMPTS;
  const entries = new Map<string, ViewerEntry>();
  const starts = new Map<string, Promise<KnowledgeViewerStatus>>();

  async function getStatus(projectKey: string): Promise<KnowledgeViewerStatus> {
    const bundlePath = await resolveBundle(projectKey);
    if (!bundlePath) {
      return unavailableStatus(projectKey, starts.has(projectKey), 'No OKF bundle is configured. Run `/okf init` first.');
    }

    let installed = true;
    let installMessage: string | undefined;
    try {
      await ensure({ autoInstall: false });
    } catch (error) {
      installed = false;
      installMessage = errorMessage(error);
    }

    const entry = entries.get(projectKey);
    if (entry && isProcessLive(entry) && await isViewerHealthy(entry.url, fetchImpl)) {
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
        ...(installMessage ? { message: installMessage } : {}),
      };
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

    const started = await start(status.bundlePath!, { openBrowser: false });
    const entry: ViewerEntry = {
      bundlePath: status.bundlePath!,
      process: started.process,
      port: started.port,
      apiPort: started.apiPort,
      url: started.url,
      exited: false,
    };
    entries.set(projectKey, entry);
    started.process.once('exit', () => {
      entry.exited = true;
      if (entries.get(projectKey) === entry) entries.delete(projectKey);
    });

    try {
      await waitForViewerHealth(started.url, fetchImpl, sleep, retryDelayMs, maxHealthAttempts);
    } catch (error) {
      await stopEntry(projectKey, entry);
      throw error;
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
    };
  }

  async function stopEntry(projectKey: string, entry: ViewerEntry): Promise<void> {
    if (entries.get(projectKey) === entry) entries.delete(projectKey);
    try {
      await stop(entry.bundlePath);
    } catch {
      // The tracked child is still ours to terminate when the `ok stop` helper fails.
    }
    if (isProcessLive(entry)) entry.process.kill('SIGTERM');
  }

  async function stopAll(): Promise<void> {
    await Promise.allSettled(starts.values());
    starts.clear();
    const active = [...entries.entries()];
    entries.clear();
    await Promise.all(active.map(async ([projectKey, entry]) => stopEntry(projectKey, entry)));
  }

  return { getStatus, getOrStartViewer, stopAll };
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
  return !entry.exited && entry.process.exitCode == null;
}

async function isViewerHealthy(url: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(url, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForViewerHealth(
  url: string,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  retryDelayMs: number,
  maxAttempts: number,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (await isViewerHealthy(url, fetchImpl)) return;
    if (attempt < maxAttempts) await sleep(retryDelayMs);
  }
  throw new OpenKnowledgeError(`open-knowledge viewer did not become healthy at ${url}`);
}

async function stopOpenKnowledgeWithSpawn(bundlePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ok', ['--cwd', bundlePath, 'stop'], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new OpenKnowledgeError(`ok stop exited with code ${code}`));
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

export const stopAllKnowledgeViewers = (): Promise<void> =>
  defaultKnowledgeViewerService.stopAll();
