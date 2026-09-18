import { stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

import { getDashboardIdentity, type DashboardIdentity } from './identity.js';

export interface DashboardHealthBody extends DashboardIdentity {
  readonly status: 'ok' | 'incoherent';
  readonly deploymentCoherent: boolean;
  readonly serverPath: string;
  readonly processStartedAtMs: number;
  readonly serverMtimeMs: number | null;
  readonly reason?: string;
}

export interface DashboardHealthResponse {
  readonly httpStatus: 200 | 503;
  readonly body: DashboardHealthBody;
}

interface DashboardHealthDependencies {
  readonly serverPath?: string;
  readonly processStartedAtMs?: number;
  readonly statEntrypoint?: (path: string) => Promise<{ readonly mtimeMs: number }>;
}

/**
 * A process is coherent only while its on-disk entrypoint is the file that
 * existed when it started. Replacing that file can also remove content-hashed
 * chunks needed by later dynamic imports, even though the HTTP listener stays
 * alive and previously loaded modules continue to work (PAN-3329).
 */
export async function buildDashboardHealthResponse(
  dependencies: DashboardHealthDependencies = {},
): Promise<DashboardHealthResponse> {
  const processStartedAtMs = dependencies.processStartedAtMs ?? performance.timeOrigin;
  const serverPath = resolve(dependencies.serverPath ?? process.argv[1] ?? '');
  const statEntrypoint = dependencies.statEntrypoint ?? stat;
  let serverMtimeMs: number | null = null;

  try {
    serverMtimeMs = (await statEntrypoint(serverPath)).mtimeMs;
  } catch (error) {
    const reason = `Dashboard entrypoint cannot be read from disk: ${error instanceof Error ? error.message : String(error)}`;
    return {
      httpStatus: 503,
      body: {
        status: 'incoherent',
        ...getDashboardIdentity(),
        deploymentCoherent: false,
        serverPath,
        processStartedAtMs,
        serverMtimeMs,
        reason,
      },
    };
  }

  if (serverMtimeMs > processStartedAtMs) {
    return {
      httpStatus: 503,
      body: {
        status: 'incoherent',
        ...getDashboardIdentity(),
        deploymentCoherent: false,
        serverPath,
        processStartedAtMs,
        serverMtimeMs,
        reason: 'Dashboard entrypoint changed after this process started; delayed imports may no longer resolve.',
      },
    };
  }

  return {
    httpStatus: 200,
    body: {
      status: 'ok',
      ...getDashboardIdentity(),
      deploymentCoherent: true,
      serverPath,
      processStartedAtMs,
      serverMtimeMs,
    },
  };
}
