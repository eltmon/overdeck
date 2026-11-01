/**
 * System collector for `pan diagnose` bundles (PAN-4643 FR-11, FR-12, NFR-1).
 *
 * Produces `environment.json` (version, build info, OS, node, terminal
 * backend, harness versions) and `services.json` (dashboard/supervisor
 * reachability). Every probe is wrapped: a thrown dependency records `null`
 * for that field plus a `CollectorFailure` — this collector never throws.
 */

import { execFile as execFileCb } from 'child_process';
import { readFile } from 'fs/promises';
import { release } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { getBuildInfo as defaultGetBuildInfo, type BuildInfo } from '../deploy/build-info.js';
import { getDashboardApiUrl as defaultGetDashboardApiUrl } from '../config.js';
import { packageRoot } from '../paths.js';
import { getSupervisorUrl as defaultGetSupervisorUrl, isSupervisorRunning as defaultIsSupervisorRunning } from '../supervisor.js';
import { hostTerminalBackendName as defaultHostTerminalBackendName } from '../terminal-backends/select.js';
import type { BundleEntry, CollectorFailure, CollectorOutcome } from './bundle.js';

const execFileAsync = promisify(execFileCb);
const PROBE_TIMEOUT_MS = 2000;
const HARNESS_VERSION_TIMEOUT_MS = 5000;

export interface ExecFileResult {
  stdout: string;
  stderr: string;
}

export interface CollectSystemDeps {
  readPackageVersion: () => Promise<string | null>;
  getBuildInfo: () => BuildInfo;
  hostTerminalBackendName: () => Promise<string>;
  execFile: (command: string, args: string[], options: { timeout: number }) => Promise<ExecFileResult>;
  fetch: typeof fetch;
  getDashboardApiUrl: () => string;
  getSupervisorUrl: () => string;
  isSupervisorRunning: () => boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function defaultReadPackageVersion(): Promise<string | null> {
  const raw = await readFile(join(packageRoot, 'package.json'), 'utf-8');
  const manifest = JSON.parse(raw) as { version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : null;
}

async function defaultExecFile(command: string, args: string[], options: { timeout: number }): Promise<ExecFileResult> {
  return execFileAsync(command, args, options);
}

const defaultDeps: CollectSystemDeps = {
  readPackageVersion: defaultReadPackageVersion,
  getBuildInfo: defaultGetBuildInfo,
  hostTerminalBackendName: defaultHostTerminalBackendName,
  execFile: defaultExecFile,
  fetch,
  getDashboardApiUrl: defaultGetDashboardApiUrl,
  getSupervisorUrl: defaultGetSupervisorUrl,
  isSupervisorRunning: defaultIsSupervisorRunning,
};

interface HarnessVersionProbe {
  installed: boolean;
  version: string | null;
}

async function probeHarnessVersion(command: string, execFileDep: CollectSystemDeps['execFile']): Promise<HarnessVersionProbe> {
  try {
    const { stdout, stderr } = await execFileDep(command, ['--version'], { timeout: HARNESS_VERSION_TIMEOUT_MS });
    const text = (stdout || stderr).trim();
    return { installed: true, version: text || null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { installed: false, version: null };
    }
    return { installed: true, version: null };
  }
}

async function buildEnvironment(deps: CollectSystemDeps): Promise<{ json: unknown; failures: CollectorFailure[] }> {
  const failures: CollectorFailure[] = [];

  let overdeckVersion: string | null = null;
  try {
    overdeckVersion = await deps.readPackageVersion();
  } catch (error) {
    failures.push({ source: 'environment.json: overdeckVersion', reason: errorMessage(error) });
  }

  let buildInfo: BuildInfo | null = null;
  try {
    buildInfo = deps.getBuildInfo();
  } catch (error) {
    failures.push({ source: 'environment.json: buildInfo', reason: errorMessage(error) });
  }

  let terminalBackend: string | null = null;
  try {
    terminalBackend = await deps.hostTerminalBackendName();
  } catch (error) {
    failures.push({ source: 'environment.json: terminalBackend', reason: errorMessage(error) });
  }

  let claudeCode: HarnessVersionProbe = { installed: false, version: null };
  try {
    claudeCode = await probeHarnessVersion('claude', deps.execFile);
  } catch (error) {
    failures.push({ source: 'environment.json: harnesses.claudeCode', reason: errorMessage(error) });
  }

  let codex: HarnessVersionProbe = { installed: false, version: null };
  try {
    codex = await probeHarnessVersion('codex', deps.execFile);
  } catch (error) {
    failures.push({ source: 'environment.json: harnesses.codex', reason: errorMessage(error) });
  }

  const json = {
    overdeckVersion,
    buildCommit: buildInfo?.buildCommit ?? null,
    builtAt: buildInfo?.builtAt ?? null,
    buildBranch: buildInfo?.buildBranch ?? null,
    buildDirty: buildInfo?.buildDirty ?? null,
    os: { platform: process.platform, release: release(), arch: process.arch },
    node: process.version,
    terminalBackend,
    harnesses: { claudeCode, codex },
  };

  return { json, failures };
}

interface UrlProbe {
  reachable: boolean;
  httpStatus: number | null;
  error: string | null;
  body: unknown;
}

async function probeUrl(fetchDep: typeof fetch, url: string): Promise<UrlProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchDep(url, { method: 'GET', signal: controller.signal });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { reachable: response.ok, httpStatus: response.status, error: null, body };
  } catch (error) {
    return { reachable: false, httpStatus: null, error: errorMessage(error), body: null };
  } finally {
    clearTimeout(timer);
  }
}

async function buildServices(deps: CollectSystemDeps): Promise<{ json: unknown; failures: CollectorFailure[] }> {
  const failures: CollectorFailure[] = [];

  let dashboardUrl: string | null = null;
  try {
    dashboardUrl = deps.getDashboardApiUrl();
  } catch (error) {
    failures.push({ source: 'services.json: dashboard.url', reason: errorMessage(error) });
  }

  let supervisorUrl: string | null = null;
  try {
    supervisorUrl = deps.getSupervisorUrl();
  } catch (error) {
    failures.push({ source: 'services.json: supervisor.url', reason: errorMessage(error) });
  }

  let pidAlive = false;
  try {
    pidAlive = deps.isSupervisorRunning();
  } catch (error) {
    failures.push({ source: 'services.json: supervisor.pidAlive', reason: errorMessage(error) });
  }

  // Run both probes concurrently — each has its own 2s abort, so running
  // them in sequence would double the worst-case wall time for no reason.
  const [dashboardProbe, supervisorProbe] = await Promise.all([
    dashboardUrl
      ? probeUrl(deps.fetch, `${dashboardUrl.replace(/\/$/, '')}/api/health`)
      : Promise.resolve<UrlProbe>({ reachable: false, httpStatus: null, error: 'dashboard URL unavailable', body: null }),
    supervisorUrl
      ? probeUrl(deps.fetch, `${supervisorUrl.replace(/\/$/, '')}/status`)
      : Promise.resolve<UrlProbe>({ reachable: false, httpStatus: null, error: 'supervisor URL unavailable', body: null }),
  ]);

  if (dashboardProbe.error) failures.push({ source: 'services.json: dashboard', reason: dashboardProbe.error });
  if (supervisorProbe.error) failures.push({ source: 'services.json: supervisor', reason: supervisorProbe.error });

  const json = {
    dashboard: {
      url: dashboardUrl,
      reachable: dashboardProbe.reachable,
      httpStatus: dashboardProbe.httpStatus,
      error: dashboardProbe.error,
    },
    supervisor: {
      pidAlive,
      url: supervisorUrl,
      reachable: supervisorProbe.reachable,
      status: supervisorProbe.body,
      error: supervisorProbe.error,
    },
  };

  return { json, failures };
}

export async function collectSystem(deps: Partial<CollectSystemDeps> = {}): Promise<CollectorOutcome> {
  const resolved: CollectSystemDeps = { ...defaultDeps, ...deps };

  const [environment, services] = await Promise.all([
    buildEnvironment(resolved),
    buildServices(resolved),
  ]);

  const entries: BundleEntry[] = [
    {
      path: 'environment.json',
      content: `${JSON.stringify(environment.json, null, 2)}\n`,
      kind: 'text',
      description: 'Overdeck version, build info, OS, node, terminal backend, harness versions',
    },
    {
      path: 'services.json',
      content: `${JSON.stringify(services.json, null, 2)}\n`,
      kind: 'text',
      description: 'Dashboard and supervisor reachability',
    },
  ];

  return { entries, failures: [...environment.failures, ...services.failures] };
}
