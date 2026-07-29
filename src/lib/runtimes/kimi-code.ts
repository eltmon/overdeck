/**
 * Kimi Code CLI runtime adapter (PAN-1837).
 *
 * Native TUI — not ACP. Kimi writes its own session tree at
 * `<kimiHome>/sessions/<workDirKey>/<sessionId>/agents/main/wire.jsonl`,
 * where `workDirKey = wd_<basename(workDir)>_<sha256(workDir).hex[:12]>`
 * (verified empirically against installed kimi 0.29.2, wi-fixture/D2 — Kimi
 * does not expose this derivation directly). Kimi generates its own session
 * id; it cannot be preset via a launch flag (D2/erratum E1: no --session, no
 * --work-dir). The id is captured post-launch as the session directory that
 * newly appears under the workspace's bucket, then persisted at
 * `~/.overdeck/agents/<id>/kimi-session-id` (mirrors codex's thread-id file)
 * so later introspection calls avoid re-walking the bucket.
 *
 * Delivery: PTY supervisor is primary (KIMI_CODE_BEHAVIOR.supportsPtySupervisor
 * is true, same as claude-code). sendMessage delegates to the existing generic
 * deliverAgentMessage() cascade (supervisor -> channels -> async tmux paste)
 * rather than re-implementing that tiering here — deliverAgentMessage already
 * dispatches on socket existence, not a hardcoded harness list, so kimi-code
 * flows through it for free once its PTY supervisor socket exists.
 *
 * getTokenUsage/getSessionCost delegate to wi8b's parseKimiSessionSync,
 * which sums every usage.record in the wire.jsonl — Kimi's own server-side
 * context cache accounting.
 */

import { exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir as mkdirAsync, readdir as readdirAsync, readFile as readFileAsync, rename as renameAsync, rm as rmAsync, stat as statAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';

import type { AgentState } from '../agents/agent-state.js';
import { getAgentStateSync, saveAgentStateSync } from '../agents/agent-state.js';
import { listAgentStates } from '../agents/queries.js';
import { deliverAgentMessage } from '../agents/delivery.js';
import { resolvePtySupervisorScriptPath } from '../channels/pty-supervisor-locate.js';
import { writePtyToken } from '../pty-token.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { prepareHarnessLaunch } from '../harness-binary.js';
import { parseKimiSessionSync } from '../cost-parsers/kimi-parser.js';
import { getOverdeckHome } from '../paths.js';
import { isPidDead } from '../pan-dir/fs-lock.js';
import { getRuntimeBehavior } from './behavior.js';
import { tmuxCreateSession, tmuxKillSession, tmuxSessionExists } from './tmux-cli.js';
import type {
  Agent,
  AgentRuntimeSync,
  CostBreakdown,
  HarnessBehavior,
  Heartbeat,
  Session,
  SpawnConfig,
  TokenUsage,
} from './types.js';

const execAsync = promisify(exec);
const SPAWN_READY_TIMEOUT_MS = 60_000; // matches KIMI_CODE_BEHAVIOR.readyTimeoutSeconds
const POLL_INTERVAL_MS = 250;

export class KimiCodeSpawnTimeout extends Error {
  readonly code = 'KIMI_CODE_SPAWN_TIMEOUT' as const;
  constructor(agentId: string) {
    super(`Kimi Code agent ${agentId} did not write a new session under its workDirKey bucket within ${SPAWN_READY_TIMEOUT_MS}ms`);
    this.name = 'KimiCodeSpawnTimeout';
  }
}

/**
 * Compute Kimi's on-disk workDirKey bucket name for a working directory.
 * Verified against `wd_kimi-fixture-scratch_ef33f89ad7cf` (workDir
 * `/tmp/kimi-fixture-scratch`) and several pre-existing real sessions on the
 * machine that produced the wi-fixture capture (e.g.
 * `wd_overdeck_b289e7acb782`, `wd_feature-pan-2858_1dc66dc5021d`).
 */
export function kimiWorkDirKey(workDir: string): string {
  const hash = createHash('sha256').update(workDir).digest('hex').slice(0, 12);
  return `wd_${basename(workDir)}_${hash}`;
}

/** Absolute path to the session bucket Kimi writes for a working directory. */
export function kimiSessionsRoot(kimiHome: string, workDir: string): string {
  return join(kimiHome, 'sessions', kimiWorkDirKey(workDir));
}

/**
 * Locate wire.jsonl for a specific captured session id under the workspace's
 * bucket. Falls back to the newest session directory when the captured id's
 * wire.jsonl is missing (e.g. never captured, or the id file is stale).
 */
export function findKimiWirePath(kimiHome: string, workspace: string, sessionId: string | null): string | null {
  if (sessionId) {
    const candidate = join(kimiSessionsRoot(kimiHome, workspace), sessionId, 'agents', 'main', 'wire.jsonl');
    if (existsSync(candidate)) return candidate;
  }
  return findLatestKimiSession(kimiHome, workspace);
}

/** Fallback: the newest session directory by wire.jsonl mtime under the workspace's bucket. */
export function findLatestKimiSession(kimiHome: string, workspace: string): string | null {
  const bucketDir = kimiSessionsRoot(kimiHome, workspace);
  let entries: string[];
  try {
    entries = readdirSync(bucketDir);
  } catch {
    return null;
  }
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    const wirePath = join(bucketDir, entry, 'agents', 'main', 'wire.jsonl');
    let mtimeMs: number;
    try {
      mtimeMs = statSync(wirePath).mtimeMs;
    } catch {
      continue;
    }
    if (!newest || mtimeMs > newest.mtimeMs) newest = { path: wirePath, mtimeMs };
  }
  return newest?.path ?? null;
}

/**
 * Async twin of {@link findKimiWirePath} (PAN-1837 review fix, P2). The
 * dashboard's transcript resolver runs on the event loop and Command Deck
 * polling re-resolves the same session repeatedly, so the sync
 * readdirSync/statSync walk here would block the loop on every poll as a
 * session's history grows. Runtime-side sync callers (kill/spawn lifecycle)
 * keep using the sync versions above — this pair exists only for dashboard
 * routes, per the runtime's own documented sync contract.
 */
export async function findKimiWirePathAsync(kimiHome: string, workspace: string, sessionId: string | null): Promise<string | null> {
  if (sessionId) {
    const candidate = join(kimiSessionsRoot(kimiHome, workspace), sessionId, 'agents', 'main', 'wire.jsonl');
    try {
      await statAsync(candidate);
      return candidate;
    } catch { /* fall through to newest-session fallback */ }
  }
  return findLatestKimiSessionAsync(kimiHome, workspace);
}

/** Async twin of {@link findLatestKimiSession} — see {@link findKimiWirePathAsync}. */
export async function findLatestKimiSessionAsync(kimiHome: string, workspace: string): Promise<string | null> {
  const bucketDir = kimiSessionsRoot(kimiHome, workspace);
  let entries: string[];
  try {
    entries = await readdirAsync(bucketDir);
  } catch {
    return null;
  }
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    const wirePath = join(bucketDir, entry, 'agents', 'main', 'wire.jsonl');
    let mtimeMs: number;
    try {
      mtimeMs = (await statAsync(wirePath)).mtimeMs;
    } catch {
      continue;
    }
    if (!newest || mtimeMs > newest.mtimeMs) newest = { path: wirePath, mtimeMs };
  }
  return newest?.path ?? null;
}

function kimiHomeDefault(): string {
  return join(homedir(), '.kimi-code');
}

/**
 * Poll a workspace's Kimi session bucket for a directory that did not exist
 * in `existingBefore`, returning the newest such directory's name (the
 * session id) once one appears. Standalone so both KimiCodeRuntimeSync.spawnAgent
 * and the production `pan start` spawn path (spawn-prep.ts, which builds its
 * own launcher/tmux session rather than delegating to this class) can capture
 * the session id the same way — mirroring codex's standalone
 * waitForCodexRollout/extractThreadIdFromRollout pair.
 */
export async function waitForNewKimiSession(
  kimiHome: string,
  workspace: string,
  existingBefore: Set<string>,
  timeoutMs: number = SPAWN_READY_TIMEOUT_MS,
): Promise<string | null> {
  const bucketDir = kimiSessionsRoot(kimiHome, workspace);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let entries: string[] = [];
    try {
      entries = readdirSync(bucketDir);
    } catch {
      entries = [];
    }
    const fresh = entries.filter((entry) => !existingBefore.has(entry));
    if (fresh.length > 0) {
      let newest: { name: string; mtimeMs: number } | null = null;
      for (const name of fresh) {
        let mtimeMs: number;
        try {
          mtimeMs = statSync(join(bucketDir, name)).mtimeMs;
        } catch {
          continue;
        }
        if (!newest || mtimeMs > newest.mtimeMs) newest = { name, mtimeMs };
      }
      if (newest) return newest.name;
    }
    await delay(POLL_INTERVAL_MS);
  }
  return null;
}

/**
 * Async twin of {@link waitForNewKimiSession} (PAN-1837 review fix, P2). The
 * conversation-spawn capture task runs on the dashboard event loop, so its
 * 250ms poll loop must not block on readdirSync/statSync — runtime-side sync
 * callers (kill/spawn lifecycle) keep the sync version above.
 */
export async function waitForNewKimiSessionAsync(
  kimiHome: string,
  workspace: string,
  existingBefore: Set<string>,
  timeoutMs: number = SPAWN_READY_TIMEOUT_MS,
): Promise<string | null> {
  const bucketDir = kimiSessionsRoot(kimiHome, workspace);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let entries: string[] = [];
    try {
      entries = await readdirAsync(bucketDir);
    } catch {
      entries = [];
    }
    const fresh = entries.filter((entry) => !existingBefore.has(entry));
    if (fresh.length > 0) {
      let newest: { name: string; mtimeMs: number } | null = null;
      for (const name of fresh) {
        let mtimeMs: number;
        try {
          mtimeMs = (await statAsync(join(bucketDir, name))).mtimeMs;
        } catch {
          continue;
        }
        if (!newest || mtimeMs > newest.mtimeMs) newest = { name, mtimeMs };
      }
      if (newest) return newest.name;
    }
    await delay(POLL_INTERVAL_MS);
  }
  return null;
}

/** Persist the captured session id to `<overdeckHome>/agents/<id>/kimi-session-id` (mirrors codex's thread-id file). */
export function writeKimiSessionId(agentId: string, sessionId: string, overdeckHome: string = getOverdeckHome()): void {
  writeFileSync(join(overdeckHome, 'agents', agentId, 'kimi-session-id'), sessionId, 'utf-8');
}

/**
 * Cross-process per-bucket mutex (PAN-1837 review fix, cycle 7). Two Kimi
 * launches sharing a cwd both snapshot the same "existing sessions" set,
 * then both independently see both new session directories as fresh and
 * pick the same newest one — silently persisting the SAME kimi-session-id
 * for two different Overdeck identities. Serializing the whole
 * snapshot -> launch -> capture sequence per workDirKey bucket makes each
 * launch's "existing" snapshot include every prior launch's
 * already-captured directory, so only the true newcomer is ever fresh.
 *
 * This MUST be a filesystem lock, not an in-memory Map: the four Kimi launch
 * owners run in separate Node processes that share no module state —
 * `pan start`/`pan strike` spawn in the short-lived CLI process, dashboard
 * conversations launch in the dashboard server process, and Deacon
 * recovery/restart can launch in its own child process. An in-memory lock
 * only serializes callers inside the ONE process that happens to hold it; it
 * is silently absent for every other process, which is exactly the
 * cross-process race this lock exists to close. Modeled on the cross-process
 * per-issue record lock in pan-dir/fs-lock.ts (mkdir-based atomic acquire +
 * PID-liveness stale-lock recovery), but with a much longer retry budget:
 * a Kimi capture can legitimately hold the lock for up to
 * SPAWN_READY_TIMEOUT_MS (60s) while it polls for the new session directory,
 * so the record-lock's ~1s retry budget would starve a second launch on the
 * same bucket almost immediately.
 */
const KIMI_CAPTURE_LOCK_POLL_MS = 250;
const KIMI_CAPTURE_LOCK_MAX_WAIT_MS = 90_000; // > SPAWN_READY_TIMEOUT_MS, so a single holder's worst case never starves a waiter
// PAN-1837 review fix (cycle 8): bounded age fallback for an ownerless lock
// (owner.json missing, corrupt, or never durably written — e.g. the holder
// died between mkdir succeeding and the write/rename completing). isPidDead
// deliberately returns false for an unreadable pid, so without this fallback
// such a lock is NEVER reclaimed and every future launch for that bucket
// waits out the full budget and fails, forever. 75s comfortably exceeds the
// legitimate worst-case single hold (~60-65s: snapshot + createSession +
// SPAWN_READY_TIMEOUT_MS capture poll + persist) while staying under
// KIMI_CAPTURE_LOCK_MAX_WAIT_MS so a waiter's own budget doesn't expire
// first. This age check applies ONLY when a live PID could not be
// determined — a lock whose owner.json names a confirmed-alive PID is never
// reclaimed by age, preserving the "never delete a lock held by a live
// process" invariant.
const KIMI_CAPTURE_LOCK_STALE_AGE_MS = 75_000;

interface KimiCaptureLockOwner {
  pid: number;
  acquiredAt: string;
}

export class KimiCaptureLockTimeoutError extends Error {
  constructor(lockPath: string, waitedMs: number) {
    super(`Timed out after ${waitedMs}ms waiting for the Kimi session-capture lock at ${lockPath} — another process is still holding it.`);
    this.name = 'KimiCaptureLockTimeoutError';
  }
}

/** Deterministic, filesystem-safe lock path for a Kimi session bucket. */
export function kimiCaptureLockPath(bucketKey: string): string {
  const hash = createHash('sha256').update(bucketKey).digest('hex').slice(0, 24);
  return join(getOverdeckHome(), 'locks', 'kimi-capture', `${hash}.lock`);
}

async function readKimiCaptureLockOwner(lockPath: string): Promise<Partial<KimiCaptureLockOwner>> {
  try {
    const parsed = JSON.parse(await readFileAsync(join(lockPath, 'owner.json'), 'utf8')) as Partial<KimiCaptureLockOwner>;
    // A corrupt/partial write can still parse as valid JSON missing pid, or
    // with a pid of the wrong type — treat anything that isn't a genuine
    // positive integer pid as "no usable owner", same as a read failure.
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * True once the lock directory itself (not owner.json) is older than the
 * stale-age bound. mkdir sets this directory's mtime at creation, and it is
 * never touched again once owner.json (a fresh directory entry) — if ever
 * written — settles, so this is trustworthy even when owner.json itself
 * never made it to disk.
 */
async function isKimiCaptureLockDirStale(lockPath: string): Promise<boolean> {
  try {
    const dirStat = await statAsync(lockPath);
    return Date.now() - dirStat.mtimeMs > KIMI_CAPTURE_LOCK_STALE_AGE_MS;
  } catch {
    // The lock directory vanished between our failed mkdir and this stat —
    // the holder already released it; the next acquire attempt will succeed.
    return true;
  }
}

async function acquireKimiCaptureLock(lockPath: string): Promise<void> {
  await mkdirAsync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + KIMI_CAPTURE_LOCK_MAX_WAIT_MS;

  for (;;) {
    try {
      await mkdirAsync(lockPath, { mode: 0o700 });
      const owner: KimiCaptureLockOwner = { pid: process.pid, acquiredAt: new Date().toISOString() };
      // Atomic write: write to a per-process temp file, then rename into
      // place. rename() is atomic on POSIX, so owner.json is either fully
      // absent or fully valid — never a partial write left behind by a
      // process that died mid-write.
      const tmpPath = join(lockPath, `owner.${process.pid}.${Date.now()}.tmp`);
      try {
        await writeFileAsync(tmpPath, JSON.stringify(owner, null, 2), 'utf8');
        await renameAsync(tmpPath, join(lockPath, 'owner.json'));
      } catch (error) {
        try { await rmAsync(tmpPath, { force: true }); } catch { /* best effort */ }
        try { await rmAsync(lockPath, { recursive: true, force: true }); } catch { /* best effort */ }
        throw error;
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = await readKimiCaptureLockOwner(lockPath);
      if (owner.pid !== undefined) {
        if (isPidDead(owner.pid)) {
          // The process that held this lock is gone (crashed CLI invocation,
          // killed Deacon child, …) — reclaim rather than wait out the full
          // budget for a holder that will never release it.
          await rmAsync(lockPath, { recursive: true, force: true });
          continue;
        }
        // A confirmed-alive pid holds this lock — keep waiting; never
        // reclaim by age when liveness is actually known.
      } else if (await isKimiCaptureLockDirStale(lockPath)) {
        // No usable owner record (missing/corrupt/never durably written) and
        // the lock directory itself is old enough that no legitimate holder
        // could still be mid-capture — reclaim.
        await rmAsync(lockPath, { recursive: true, force: true });
        continue;
      }
    }

    if (Date.now() >= deadline) {
      throw new KimiCaptureLockTimeoutError(lockPath, KIMI_CAPTURE_LOCK_MAX_WAIT_MS);
    }
    await delay(KIMI_CAPTURE_LOCK_POLL_MS);
  }
}

async function releaseKimiCaptureLock(lockPath: string): Promise<void> {
  await rmAsync(lockPath, { recursive: true, force: true });
}

export async function withKimiSessionCaptureLock<T>(kimiHome: string, workspace: string, fn: () => Promise<T>): Promise<T> {
  const bucketKey = kimiSessionsRoot(kimiHome, workspace);
  const lockPath = kimiCaptureLockPath(bucketKey);
  await acquireKimiCaptureLock(lockPath);
  try {
    return await fn();
  } finally {
    await releaseKimiCaptureLock(lockPath);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function pollUntilSessionGone(agentId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await tmuxSessionExists(agentId))) return true;
    await delay(POLL_INTERVAL_MS);
  }
  return false;
}

export interface KimiCodeRuntimeOptions {
  readonly overdeckHome?: string;
  readonly kimiHome?: string;
  readonly execCommand?: (command: string) => Promise<{ readonly stdout: string }>;
  readonly prepareLaunch?: () => Promise<{ readonly binaryPath: string; readonly pathExport: string }>;
  readonly listAgentStates?: () => AgentState[];
  readonly deliverMessage?: (agentId: string, message: string) => Promise<{ readonly ok: boolean; readonly failure?: string }>;
  /** Resolves the PTY supervisor script path. Defaults to resolvePtySupervisorScriptPath(). */
  readonly resolveSupervisorScriptPath?: () => string;
  /** Writes the PTY supervisor's auth token for an agent. Defaults to the real writePtyToken(). */
  readonly writePtyTokenFor?: (agentId: string) => Promise<string>;
}

export class KimiCodeRuntimeSync implements AgentRuntimeSync {
  readonly name = 'kimi-code' as const;
  private readonly overdeckHomeOverride: string | undefined;
  private readonly kimiHomeOverride: string | undefined;
  private readonly execCommand: (command: string) => Promise<{ readonly stdout: string }>;
  private readonly prepareLaunch: () => Promise<{ readonly binaryPath: string; readonly pathExport: string }>;
  private readonly resolveAgentStates: () => AgentState[];
  private readonly deliverMessage: (agentId: string, message: string) => Promise<{ readonly ok: boolean; readonly failure?: string }>;
  private readonly resolveSupervisorScriptPath: () => string;
  private readonly writePtyTokenFor: (agentId: string) => Promise<string>;

  constructor(options: KimiCodeRuntimeOptions = {}) {
    this.overdeckHomeOverride = options.overdeckHome;
    this.kimiHomeOverride = options.kimiHome;
    this.execCommand = options.execCommand ?? (async (command) => execAsync(command));
    this.prepareLaunch = options.prepareLaunch ?? (() => prepareHarnessLaunch('kimi-code'));
    this.resolveAgentStates = options.listAgentStates ?? (() => listAgentStates());
    this.deliverMessage = options.deliverMessage ?? ((agentId, message) => deliverAgentMessage(agentId, message, 'runtime:kimi-code'));
    this.resolveSupervisorScriptPath = options.resolveSupervisorScriptPath ?? resolvePtySupervisorScriptPath;
    this.writePtyTokenFor = options.writePtyTokenFor ?? writePtyToken;
  }

  getHarnessBehavior(): HarnessBehavior {
    return getRuntimeBehavior('kimi-code');
  }

  getSessionPath(agentId: string): string | null {
    const workspace = this.workspaceFor(agentId);
    if (!workspace) return null;
    return findKimiWirePath(this.kimiHome(), workspace, this.readSessionId(agentId));
  }

  getLastActivity(agentId: string): Date | null {
    const path = this.getSessionPath(agentId);
    if (!path) return null;
    try {
      return statSync(path).mtime;
    } catch {
      return null;
    }
  }

  getHeartbeat(agentId: string): Heartbeat | null {
    const lastActivity = this.getLastActivity(agentId);
    if (!lastActivity) return null;
    return {
      timestamp: lastActivity,
      agentId,
      source: 'jsonl',
      confidence: 'medium',
    };
  }

  getTokenUsage(agentId: string): TokenUsage | null {
    const path = this.getSessionPath(agentId);
    if (!path) return null;
    return parseKimiSessionSync(path)?.usage ?? null;
  }

  getSessionCost(agentId: string): CostBreakdown | null {
    const path = this.getSessionPath(agentId);
    if (!path) return null;
    const parsed = parseKimiSessionSync(path);
    if (!parsed) return null;
    return {
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      totalCost: parsed.cost_v2 ?? parsed.cost ?? 0,
      currency: 'USD',
    };
  }

  async sendMessage(agentId: string, message: string): Promise<void> {
    const result = await this.deliverMessage(agentId, message);
    if (!result.ok) {
      throw new Error(`Kimi Code agent ${agentId}: message delivery failed${result.failure ? ` (${result.failure})` : ''}`);
    }
  }

  async killAgent(agentId: string): Promise<void> {
    // Step 1: Ctrl-C the interactive TUI so it can wind down cleanly.
    try {
      await this.execCommand(`tmux -L overdeck send-keys -t ${shellQuote(agentId)} C-c 2>/dev/null || true`);
    } catch {
      // Best effort: the SIGTERM/SIGKILL ladder below still tears down the session.
    }
    if (await pollUntilSessionGone(agentId, 2_000)) return;

    // Step 2: SIGTERM the pane's process group.
    let panePid: string | null = null;
    try {
      const { stdout } = await this.execCommand(
        `tmux -L overdeck list-panes -t ${shellQuote(agentId)} -F '#{pane_pid}' 2>/dev/null`,
      );
      panePid = stdout.trim() || null;
      if (panePid) {
        await this.execCommand(`kill -TERM -- -${panePid} 2>/dev/null || kill -TERM ${panePid} 2>/dev/null || true`);
      }
    } catch {
      // Best effort: the remaining kill ladder still tears down the tmux session.
    }
    if (await pollUntilSessionGone(agentId, 5_000)) return;

    // Step 3: SIGKILL, then fall back to tmux kill-session outright.
    if (panePid) {
      try {
        await this.execCommand(`kill -KILL -- -${panePid} 2>/dev/null || kill -KILL ${panePid} 2>/dev/null || true`);
      } catch {
        // Best effort: tmuxKillSession below removes any remaining session.
      }
    }
    if (await tmuxSessionExists(agentId)) await tmuxKillSession(agentId);
  }

  async spawnAgent(config: SpawnConfig): Promise<Agent> {
    const { pathExport } = await this.prepareLaunch();
    const model = config.model ?? '';

    const bucketDir = kimiSessionsRoot(this.kimiHome(), config.workspace);
    let existingBefore = new Set<string>();
    try {
      existingBefore = new Set(readdirSync(bucketDir));
    } catch {
      // Bucket doesn't exist yet — every session dir that appears is new.
    }

    // The PTY supervisor tier of deliverAgentMessage requires BOTH the
    // pty-<id>.sock (created when the supervisor process binds it) AND a
    // readable pty-token it authenticates requests against — write the token
    // and resolve the real, package/desktop-safe script path (not a hardcoded
    // dist/ literal, which silently breaks under desktop packaging or a
    // mid-reload generation, PAN-3172) before the tmux session exists.
    mkdirSync(join(this.home(), 'agents', config.agentId), { recursive: true });
    const supervisorScriptPath = this.resolveSupervisorScriptPath();
    await this.writePtyTokenFor(config.agentId);

    const launcherContent = generateLauncherScriptSync({
      role: 'work',
      workingDir: config.workspace,
      harness: 'kimi-code',
      kimiCodeModel: model,
      kimiCodeYolo: true,
      extraEnvExports: [pathExport],
      overdeckEnv: { agentId: config.agentId },
      setTerminalEnv: true,
      useSupervisor: true,
      supervisorScriptPath,
      unsetProviderEnv: true,
    });
    const launcherScript = this.agentPath(config.agentId, 'launcher.sh');
    writeFileSync(launcherScript, launcherContent, { mode: 0o755 });

    await tmuxCreateSession(config.agentId, config.workspace, `bash ${shellQuote(launcherScript)}`, config.env ?? {});

    try {
      const sessionId = await this.waitForNewSessionId(config.workspace, existingBefore);
      if (!sessionId) throw new KimiCodeSpawnTimeout(config.agentId);
      this.writeSessionId(config.agentId, sessionId);
      this.markSupervisorEnabled(config.agentId);

      if (config.prompt) await this.sendMessage(config.agentId, config.prompt);

      return {
        id: config.agentId,
        sessionId,
        runtime: 'kimi-code',
        model,
        workspace: config.workspace,
        startedAt: new Date(),
      };
    } catch (error) {
      if (await tmuxSessionExists(config.agentId)) await tmuxKillSession(config.agentId);
      throw error;
    }
  }

  listSessions(workspace?: string): Session[] {
    const sessions: Session[] = [];
    for (const state of this.resolveAgentStates()) {
      if (state.harness !== 'kimi-code') continue;
      if (workspace && state.workspace !== workspace) continue;

      const sessionId = this.readSessionId(state.id);
      if (!sessionId) continue;

      const sessionPath = findKimiWirePath(this.kimiHome(), state.workspace, sessionId);
      let lastActivity: Date;
      try {
        lastActivity = statSync(sessionPath ?? '').mtime;
      } catch {
        continue;
      }

      sessions.push({
        id: sessionId,
        agentId: state.id,
        workspace: state.workspace,
        model: state.model ?? '',
        startedAt: new Date(state.startedAt),
        lastActivity,
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
      });
    }
    return sessions;
  }

  async isRunning(agentId: string): Promise<boolean> {
    return tmuxSessionExists(agentId);
  }

  private home(): string {
    return this.overdeckHomeOverride ?? getOverdeckHome();
  }

  private kimiHome(): string {
    return this.kimiHomeOverride ?? kimiHomeDefault();
  }

  private agentPath(agentId: string, file: string): string {
    return join(this.home(), 'agents', agentId, file);
  }

  private workspaceFor(agentId: string): string | null {
    return getAgentStateSync(agentId)?.workspace ?? null;
  }

  private readSessionId(agentId: string): string | null {
    try {
      return readFileSync(this.agentPath(agentId, 'kimi-session-id'), 'utf-8').trim() || null;
    } catch {
      return null;
    }
  }

  private writeSessionId(agentId: string, sessionId: string): void {
    writeKimiSessionId(agentId, sessionId, this.home());
  }

  /**
   * Best-effort: mark the persisted agent state as supervisor-enabled so
   * prepareSupervisorForRelaunch (supervisor-channels.ts) re-supervises this
   * agent on relaunch instead of falling back to useSupervisor:false. A
   * no-op when no state has been saved for this agent yet (some callers of
   * this adapter's spawnAgent create state afterward).
   */
  private markSupervisorEnabled(agentId: string): void {
    const state = getAgentStateSync(agentId);
    if (!state) return;
    state.supervisorEnabled = true;
    saveAgentStateSync(state);
  }

  private async waitForNewSessionId(workspace: string, existingBefore: Set<string>): Promise<string | null> {
    return waitForNewKimiSession(this.kimiHome(), workspace, existingBefore);
  }
}

export function createKimiCodeRuntimeSync(options: KimiCodeRuntimeOptions = {}): KimiCodeRuntimeSync {
  return new KimiCodeRuntimeSync(options);
}
