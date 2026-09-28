/**
 * Per-agent Prime Agent daemon ownership (PAN-3668 WI-10, FR-21, FR-4, D2, D3).
 *
 * Every Overdeck launch passes `--daemon-socket <pd-….sock>`, so each agent gets a
 * private Prime supervisor. That supervisor is detached and outlives its RPC client,
 * so Overdeck reaps it: find the `prime-agent status --json` entry whose `socketPath`
 * equals the agent's socket, send SIGTERM to its process group, poll until the entry is
 * gone (≤ 5 s at 250 ms), then SIGKILL the group. `prime-agent shutdown` cannot target a
 * per-agent socket, and the user's default daemon is never signaled.
 *
 * Verified on prime-agent 0.8.0 (2026-09-25): `kill -TERM -- -<supervisor pid>` leaves
 * no Prime process, and `status --json` then lists no entry for the socket. Only
 * promisified `execFile` is used (NFR-1).
 */
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { resolveHarnessBinary } from '../harness-binary.js';
import { getOverdeckHome } from '../paths.js';
import { isPrimeAgentDaemonSocketPath, primeAgentDaemonSocketPath } from '../runtimes/storage/prime-agent.js';

const execFileAsync = promisify(execFile);

export const PRIME_AGENT_REAP_GRACE_MS = 5_000;
export const PRIME_AGENT_REAP_POLL_MS = 250;
const STATUS_TIMEOUT_MS = 10_000;

export interface PrimeAgentSupervisor {
  socketPath: string;
  pid: number;
  sessionCount: number;
}

/** Runs `<binary> status --json` and returns its stdout. */
export type PrimeAgentStatusRunner = (binary: string) => Promise<string>;

export async function runPrimeAgentStatus(binary: string): Promise<string> {
  const { stdout } = await execFileAsync(binary, ['status', '--json'], { timeout: STATUS_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

/** Every supervisor `status --json` lists. Entries without a socket path or pid are skipped. */
export async function listPrimeAgentSupervisors(binary: string, run: PrimeAgentStatusRunner = runPrimeAgentStatus): Promise<PrimeAgentSupervisor[]> {
  const parsed: unknown = JSON.parse(await run(binary));
  if (!Array.isArray(parsed)) return [];
  const supervisors: PrimeAgentSupervisor[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const { socketPath, pid, sessionCount } = entry as Record<string, unknown>;
    if (typeof socketPath !== 'string' || typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1) continue;
    supervisors.push({ socketPath, pid, sessionCount: typeof sessionCount === 'number' ? sessionCount : 0 });
  }
  return supervisors;
}

/** The supervisor bound to exactly `socketPath`, or null. */
export async function findPrimeAgentSupervisor(
  binary: string,
  socketPath: string,
  run: PrimeAgentStatusRunner = runPrimeAgentStatus,
): Promise<{ pid: number; sessionCount: number } | null> {
  const match = (await listPrimeAgentSupervisors(binary, run)).find((supervisor) => supervisor.socketPath === socketPath);
  return match ? { pid: match.pid, sessionCount: match.sessionCount } : null;
}

/** The Prime binary the reaper runs `status --json` with, or null when Prime is not installed. */
async function defaultBinary(): Promise<string | null> {
  return resolveHarnessBinary('prime-agent');
}

export interface PrimeAgentReapDeps {
  /** Prime executable; defaults to the resolved harness binary. */
  binary?: string;
  run?: PrimeAgentStatusRunner;
  /** Signals a process group (`process.kill(-pid, signal)`). */
  killGroup?: (pid: number, signal: NodeJS.Signals) => void;
  sleep?: (ms: number) => Promise<void>;
  home?: string;
}

function defaultKillGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

/**
 * Reap the agent's private Prime supervisor (D3). Idempotent: `'none'` when no
 * supervisor is listed for its socket, or when Prime is not installed (no daemon can
 * exist). Never signals a socket other than the agent's.
 */
export async function reapPrimeAgentDaemon(agentId: string, deps: PrimeAgentReapDeps = {}): Promise<'none' | 'terminated' | 'killed'> {
  const binary = deps.binary ?? await defaultBinary();
  if (!binary) return 'none';
  const run = deps.run ?? runPrimeAgentStatus;
  const killGroup = deps.killGroup ?? defaultKillGroup;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const socketPath = primeAgentDaemonSocketPath(agentId, deps.home);

  const supervisor = await findPrimeAgentSupervisor(binary, socketPath, run);
  if (!supervisor) return 'none';

  killGroup(supervisor.pid, 'SIGTERM');
  for (let waited = 0; waited < PRIME_AGENT_REAP_GRACE_MS; waited += PRIME_AGENT_REAP_POLL_MS) {
    await sleep(PRIME_AGENT_REAP_POLL_MS);
    const still = await findPrimeAgentSupervisor(binary, socketPath, run).catch(() => supervisor);
    if (!still) return 'terminated';
  }
  killGroup(supervisor.pid, 'SIGKILL');
  return 'killed';
}

export interface PrimeAgentOrphanDeps {
  /** Prime executable; defaults to the resolved harness binary. */
  binary?: string;
  run?: PrimeAgentStatusRunner;
  home?: string;
  /** Candidate owner ids: agent and conversation directory names. */
  listOwnerIds?: () => Promise<string[]>;
  /** Whether an owner's pane and harness are still running. */
  isOwnerAlive?: (ownerId: string) => Promise<boolean>;
}

async function defaultIsOwnerAlive(ownerId: string): Promise<boolean> {
  const { isAlive, isConfirmedDead } = await import('../agents/liveness.js');
  return !isConfirmedDead(await isAlive(ownerId, { readHarness: () => 'prime-agent' }));
}

/**
 * Overdeck-owned supervisors (socket under `$OVERDECK_HOME/sockets/pd-*.sock`) whose
 * owning agent or conversation is gone. The user's own Prime daemons are never listed.
 */
export async function listOrphanedPrimeAgentDaemons(deps: PrimeAgentOrphanDeps = {}): Promise<Array<{ socketPath: string; pid: number }>> {
  const home = deps.home ?? getOverdeckHome();
  const listOwnerIds = deps.listOwnerIds
    ?? (async () => (await readdir(join(home, 'agents'), { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name));
  const isOwnerAlive = deps.isOwnerAlive ?? defaultIsOwnerAlive;

  const binary = deps.binary ?? await defaultBinary();
  if (!binary) return [];
  const owned = (await listPrimeAgentSupervisors(binary, deps.run ?? runPrimeAgentStatus))
    .filter((supervisor) => isPrimeAgentDaemonSocketPath(supervisor.socketPath, home));
  if (owned.length === 0) return [];

  const ownerBySocket = new Map<string, string>();
  for (const ownerId of await listOwnerIds()) {
    try {
      ownerBySocket.set(primeAgentDaemonSocketPath(ownerId, home), ownerId);
    } catch {
      // An id whose socket path would be too long never owned a daemon.
    }
  }

  const orphans: Array<{ socketPath: string; pid: number }> = [];
  for (const supervisor of owned) {
    const ownerId = ownerBySocket.get(supervisor.socketPath);
    if (ownerId && await isOwnerAlive(ownerId)) continue;
    orphans.push({ socketPath: supervisor.socketPath, pid: supervisor.pid });
  }
  return orphans;
}
