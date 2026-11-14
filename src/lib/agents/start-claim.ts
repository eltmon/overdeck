/**
 * One in-flight start per agent id, shared by every process (PAN-5243).
 *
 * `pan start` runs `spawnAgent` in its own process, and so does the dashboard's
 * start route (through a `pan start --local` subprocess). The pane-exists guard
 * in `spawnAgent` cannot see a launch in progress: on Herdr a pane takes its
 * agent name only at the end of `startAgent`, several seconds after the guard.
 * Two starts in that window both launched, and the loser's cleanup then stopped
 * the winner by name.
 *
 * The claim closes the window. It is a file in the agent dir, created with
 * O_EXCL, that records the claiming pid, the time, and a per-attempt token (two
 * starts in one process share a pid, so the token is the identity and the pid
 * is only the liveness probe). A start that finds a live claim throws
 * `AgentAlreadyRunningError` at once, before it writes anything into the agent
 * dir. A claim whose pid is dead, or that is older than `START_CLAIM_STALE_MS`,
 * is reclaimed. There is no wait or retry: a second start reports the first.
 *
 * Imports only Node built-ins and the agent-dir leaf.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { getAgentDir } from './agent-state-read.js';

export const START_CLAIM_FILE = 'start.claim';
/** A claim this old is abandoned even when its pid answers (pid reuse). */
export const START_CLAIM_STALE_MS = 30 * 60_000;
/** An unreadable claim (its writer died between create and write) is abandoned after this. */
const UNREADABLE_CLAIM_STALE_MS = 60_000;

export interface StartClaimHolder {
  readonly pid: number;
  readonly claimedAt: string;
  readonly token: string;
}

export interface StartClaim {
  readonly holder: StartClaimHolder;
  /** Throws `AgentAlreadyRunningError` when another start reclaimed this claim. */
  assertHeld(): Promise<void>;
  /** Removes the claim file if it is still this attempt's. Idempotent. */
  release(): Promise<void>;
}

export interface StartClaimOptions {
  readonly now?: () => number;
  readonly isPidAlive?: (pid: number) => boolean;
}

/**
 * Another start owns this agent id: its pane is live (`running`), or a start
 * holds the claim and is launching it (`starting`). The message keeps the
 * "already running" phrase that callers such as `service-reactive` match on.
 */
export class AgentAlreadyRunningError extends Error {
  readonly code = 'AGENT_ALREADY_RUNNING';
  constructor(readonly agentId: string, readonly phase: 'running' | 'starting', detail?: string) {
    super(phase === 'running'
      ? `Agent ${agentId} already running${detail ? ` (${detail})` : ''}. Use 'pan tell' to message it.`
      : `Agent ${agentId} already running: another start is launching it${detail ? ` (${detail})` : ''}. Use 'pan tell' to message it once it is up.`);
    this.name = 'AgentAlreadyRunningError';
  }
}

export function startClaimPath(agentId: string): string {
  return join(getAgentDir(agentId), START_CLAIM_FILE);
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function parseHolder(raw: string): StartClaimHolder | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StartClaimHolder>;
    if (typeof parsed.pid !== 'number' || typeof parsed.claimedAt !== 'string' || typeof parsed.token !== 'string') return null;
    return { pid: parsed.pid, claimedAt: parsed.claimedAt, token: parsed.token };
  } catch {
    return null;
  }
}

async function readRaw(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function isAbandoned(path: string, raw: string, now: number, isPidAlive: (pid: number) => boolean): Promise<boolean> {
  const holder = parseHolder(raw);
  if (!holder) {
    const info = await stat(path).catch(() => null);
    return info === null || now - info.mtimeMs > UNREADABLE_CLAIM_STALE_MS;
  }
  const claimedAt = Date.parse(holder.claimedAt);
  return !isPidAlive(holder.pid) || !Number.isFinite(claimedAt) || now - claimedAt > START_CLAIM_STALE_MS;
}

function describeHolder(raw: string): string | undefined {
  const holder = parseHolder(raw);
  return holder ? `pid ${holder.pid} claimed the start at ${holder.claimedAt}` : undefined;
}

/**
 * Take the start claim for `agentId`, or throw `AgentAlreadyRunningError`
 * (`starting`) when a live start already holds it.
 */
export async function claimAgentStart(agentId: string, options: StartClaimOptions = {}): Promise<StartClaim> {
  const now = options.now ?? Date.now;
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
  const path = startClaimPath(agentId);
  await mkdir(getAgentDir(agentId), { recursive: true });
  const holder: StartClaimHolder = { pid: process.pid, claimedAt: new Date(now()).toISOString(), token: randomUUID() };
  const body = `${JSON.stringify(holder)}\n`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600);
      try {
        await file.writeFile(body, 'utf8');
      } finally {
        await file.close();
      }
      return ownedClaim(agentId, path, holder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const raw = await readRaw(path);
    if (raw === null) continue; // released between our create and our read
    if (!(await isAbandoned(path, raw, now(), isPidAlive))) {
      throw new AgentAlreadyRunningError(agentId, 'starting', describeHolder(raw));
    }
    // Reclaim only the claim we judged abandoned: a fresh claim another start
    // wrote in the meantime must survive.
    if ((await readRaw(path)) === raw) await unlink(path).catch(() => undefined);
  }
  const raw = await readRaw(path);
  throw new AgentAlreadyRunningError(agentId, 'starting', raw ? describeHolder(raw) : undefined);
}

function ownedClaim(agentId: string, path: string, holder: StartClaimHolder): StartClaim {
  let released = false;
  const isOurs = async (): Promise<boolean> => {
    const raw = await readRaw(path).catch(() => null);
    return raw !== null && parseHolder(raw)?.token === holder.token;
  };
  return {
    holder,
    async assertHeld() {
      if (released || !(await isOurs())) {
        const raw = await readRaw(path).catch(() => null);
        throw new AgentAlreadyRunningError(agentId, 'starting', raw ? describeHolder(raw) : 'this start lost its claim');
      }
    },
    async release() {
      if (released) return;
      released = true;
      if (await isOurs()) await unlink(path).catch(() => undefined);
    },
  };
}
