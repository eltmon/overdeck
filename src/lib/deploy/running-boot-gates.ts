/**
 * Read the Deacon/resume boot gates of the dashboard that is running now, so
 * `pan reload` can hand its resume gate to the server that replaces it
 * (PAN-3899). Deacon is never carried: reload always boots it on.
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
  readonly fetchHealth?: (url: string, timeoutMs: number) => Promise<unknown>;
  readonly readEnviron?: (pid: number) => Promise<string>;
  /**
   * Budget of each health read. The second read is the retry: a dashboard under
   * load can miss the first budget, and the reload has already waited for
   * approval, so a longer second try costs nothing.
   */
  readonly attemptTimeoutsMs?: readonly number[];
}

/** The gates, or why they could not be read. */
export type RunningBootGatesRead =
  | { readonly gates: BootGateState; readonly reason?: undefined }
  | { readonly gates: null; readonly reason: string };

const DEFAULT_ATTEMPT_TIMEOUTS_MS = [2_000, 8_000] as const;

/**
 * GET the health body with a hard budget. An incoherent (503) server still
 * reports its gates, so the body is read whatever the status. A non-JSON body
 * or a missed budget throws.
 */
export async function fetchHealthBody(url: string, timeoutMs: number): Promise<unknown> {
  // AbortController + setTimeout rather than AbortSignal.timeout so the budget
  // runs on the timers tests can drive.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`no answer within ${timeoutMs}ms`)), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
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

function describeError(error: unknown): string {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The boot gates of the dashboard serving `apiPort`. Misses (with the reason)
 * when no dashboard answers within two tries, the answer is not JSON, it
 * serves another checkout than `repoRoot`, or its gates cannot be read.
 */
export async function readRunningDashboardBootGates(
  apiPort: number,
  repoRoot: string,
  deps: RunningBootGatesDeps = {},
): Promise<RunningBootGatesRead> {
  const url = `http://127.0.0.1:${apiPort}/api/health`;
  const fetchHealth = deps.fetchHealth ?? fetchHealthBody;
  const budgets = deps.attemptTimeoutsMs ?? DEFAULT_ATTEMPT_TIMEOUTS_MS;
  let body: unknown;
  let lastError = 'no health read attempted';
  let answered = false;
  for (const timeoutMs of budgets) {
    try {
      body = await fetchHealth(url, timeoutMs);
      answered = true;
      break;
    } catch (error) {
      lastError = describeError(error);
    }
  }
  if (!answered) return { gates: null, reason: `${url} unreadable after ${budgets.length} tries: ${lastError}` };
  if (!body || typeof body !== 'object') return { gates: null, reason: `${url} returned no health object` };
  const payload = body as Record<string, unknown>;
  if (typeof payload.repoRoot !== 'string' || resolve(payload.repoRoot) !== resolve(repoRoot)) {
    return { gates: null, reason: `the dashboard on port ${apiPort} serves ${String(payload.repoRoot)}, not ${repoRoot}` };
  }

  const reported = parseBootGateState(payload.bootGates);
  if (reported) return { gates: reported };

  const pid = payload.pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return { gates: null, reason: 'the running dashboard reports neither its gates nor a pid' };
  }
  try {
    return { gates: gatesFromEnviron(await (deps.readEnviron ?? defaultReadEnviron)(pid)) };
  } catch (error) {
    return { gates: null, reason: `could not read /proc/${pid}/environ: ${describeError(error)}` };
  }
}
