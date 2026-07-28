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
 * getTokenUsage/getSessionCost return null until wi8b (kimi-parser.ts) lands,
 * matching the ACP adapter's own stub for the same reason (acp.ts:105-111).
 */

import { exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import type { AgentState } from '../agents/agent-state.js';
import { getAgentStateSync, saveAgentStateSync } from '../agents/agent-state.js';
import { listAgentStates } from '../agents/queries.js';
import { deliverAgentMessage } from '../agents/delivery.js';
import { resolvePtySupervisorScriptPath } from '../channels/pty-supervisor-locate.js';
import { writePtyToken } from '../pty-token.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { prepareHarnessLaunch } from '../harness-binary.js';
import { getOverdeckHome } from '../paths.js';
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

function kimiHomeDefault(): string {
  return join(homedir(), '.kimi-code');
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

  getTokenUsage(_agentId: string): TokenUsage | null {
    // Wired to the wi8b parser once src/lib/cost-parsers/kimi-parser.ts lands
    // (matches the ACP adapter's own stub at acp.ts:105 for the same reason).
    return null;
  }

  getSessionCost(_agentId: string): CostBreakdown | null {
    return null;
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
    writeFileSync(this.agentPath(agentId, 'kimi-session-id'), sessionId, 'utf-8');
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
    const bucketDir = kimiSessionsRoot(this.kimiHome(), workspace);
    const deadline = Date.now() + SPAWN_READY_TIMEOUT_MS;
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
}

export function createKimiCodeRuntimeSync(options: KimiCodeRuntimeOptions = {}): KimiCodeRuntimeSync {
  return new KimiCodeRuntimeSync(options);
}
