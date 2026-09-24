/**
 * Read the Deacon/resume boot gates of the dashboard that is running now, so
 * `pan reload` can hand them to the server that replaces it (PAN-3899).
 *
 * The gates live nowhere but the running process: `applyBootGateEnv` stamps
 * them into the server's env at spawn. `/api/health` reports them
 * (`bootGates`); a server built before that field existed still carries the env
 * markers, so the fallback reads them from `/proc/<pid>/environ`.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  DEACON_GATE_SOURCE_ENV,
  parseBootGateState,
  resolveBootGates,
  RESUME_GATE_SOURCE_ENV,
  type BootGateState,
} from '../boot-gates.js';

const GATE_ENV_KEYS = [
  'OVERDECK_DISABLE_DEACON',
  DEACON_GATE_SOURCE_ENV,
  'OVERDECK_RESUME',
  'OVERDECK_NO_RESUME',
  RESUME_GATE_SOURCE_ENV,
];

export interface RunningBootGatesDeps {
  readonly fetchHealth?: (url: string) => Promise<unknown>;
  readonly readEnviron?: (pid: number) => Promise<string>;
}

async function defaultFetchHealth(url: string): Promise<unknown> {
  // An incoherent (503) server still reports its gates, so read the body either way.
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
  return res.json();
}

async function defaultReadEnviron(pid: number): Promise<string> {
  return readFile(`/proc/${pid}/environ`, 'utf8');
}

function gatesFromEnviron(environ: string): BootGateState {
  const env: NodeJS.ProcessEnv = {};
  for (const entry of environ.split('\0')) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const key = entry.slice(0, eq);
    if (GATE_ENV_KEYS.includes(key)) env[key] = entry.slice(eq + 1);
  }
  return resolveBootGates({}, env);
}

/**
 * The boot gates of the dashboard serving `apiPort`, or null when no dashboard
 * answers, the one that answers serves another checkout than `repoRoot`, or its
 * gates cannot be read.
 */
export async function readRunningDashboardBootGates(
  apiPort: number,
  repoRoot: string,
  deps: RunningBootGatesDeps = {},
): Promise<BootGateState | null> {
  let body: unknown;
  try {
    body = await (deps.fetchHealth ?? defaultFetchHealth)(`http://127.0.0.1:${apiPort}/api/health`);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const payload = body as Record<string, unknown>;
  if (typeof payload.repoRoot !== 'string' || resolve(payload.repoRoot) !== resolve(repoRoot)) return null;

  const reported = parseBootGateState(payload.bootGates);
  if (reported) return reported;

  const pid = payload.pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  try {
    return gatesFromEnviron(await (deps.readEnviron ?? defaultReadEnviron)(pid));
  } catch {
    return null;
  }
}
