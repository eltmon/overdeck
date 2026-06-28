/**
 * Codex CLI runtime adapter (PAN-1574).
 *
 * Session model (D-7 external store): Codex writes rollout JSONL files to
 * $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<uuid>-<threadId>.jsonl
 * The thread-id is captured at spawn time and persisted at
 * ~/.overdeck/agents/<id>/codex-thread-id so later introspection calls
 * can locate the correct rollout file.
 *
 * Spawn, sendMessage, killAgent, getHeartbeat, getTokenUsage, and
 * getSessionCost are stubs in this bead — they throw NotImplementedError
 * and will be filled in by downstream beads (spawn-agent, send-message,
 * kill-agent, cost-parser, notify-heartbeat).
 */

import { existsSync, readFileSync, statSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, chmodSync, openSync, readSync, closeSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { exec } from 'node:child_process'
import { Effect } from 'effect'
import type {
  AgentRuntime,
  AgentRuntimeSync,
  AgentRuntimeError,
  HarnessBehavior,
  Heartbeat,
  TokenUsage,
  CostBreakdown,
  Session,
  SpawnConfig,
  Agent,
} from './types.js'
import { CODEX_BEHAVIOR } from './behavior.js'
import { sessionExists, killSession, listSessionsSync, createSession } from '../tmux.js'
import { TmuxError, ProcessSpawnError, ProcessTimeoutError } from '../errors.js'
import { parseCodexSessionSync } from '../cost-parsers/codex-parser.js'

const execAsync = promisify(exec)

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function overdeckDir(): string {
  return join(homedir(), '.overdeck')
}

function agentsDir(): string {
  return join(overdeckDir(), 'agents')
}

function agentDirFor(agentId: string): string {
  return join(agentsDir(), agentId)
}

function threadIdPathFor(agentId: string): string {
  return join(agentDirFor(agentId), 'codex-thread-id')
}

/** Resolve $CODEX_HOME: env var → ~/.codex fallback. */
export function codexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), '.codex')
}

/** Read the persisted Codex thread-id for session lookup. */
function readThreadId(agentId: string): string | null {
  const p = threadIdPathFor(agentId)
  if (!existsSync(p)) return null
  try {
    return readFileSync(p, 'utf-8').trim() || null
  } catch {
    return null
  }
}

/** Persist the thread-id after spawn so introspection can find the rollout file. */
export function writeThreadId(agentId: string, threadId: string): void {
  writeFileSync(threadIdPathFor(agentId), threadId, { mode: 0o600 })
}

/** Cache resolved rollout paths to avoid repeated synchronous directory walks. */
const rolloutPathCache = new Map<string, string>()

/**
 * Walk $CODEX_HOME/sessions looking for a rollout file whose name ends with
 * `-<threadId>.jsonl`.  The directory tree is YYYY/MM/DD/…, so we walk it
 * recursively.
 *
 * Results are cached by (codexHomeDir, threadId) so the walk runs at most once
 * per unique thread; the hot paths (getHeartbeat tier-2, getTokenUsage,
 * getSessionCost) pay only an existsSync check on subsequent calls.
 */
export function findRolloutPath(codexHomeDir: string, threadId: string): string | null {
  const cacheKey = `${codexHomeDir}:${threadId}`
  const cached = rolloutPathCache.get(cacheKey)
  if (cached) {
    if (existsSync(cached)) return cached
    // File was deleted — evict and re-walk.
    rolloutPathCache.delete(cacheKey)
  }
  const sessionsRoot = join(codexHomeDir, 'sessions')
  if (!existsSync(sessionsRoot)) return null
  const result = walkForThread(sessionsRoot, threadId)
  if (result) rolloutPathCache.set(cacheKey, result)
  return result
}

function walkForThread(dir: string, threadId: string): string | null {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      const hit = walkForThread(full, threadId)
      if (hit) return hit
    } else if (entry.endsWith(`-${threadId}.jsonl`)) {
      return full
    }
  }
  return null
}

const SPAWN_READY_TIMEOUT_MS = 60_000

export class CodexSpawnTimeout extends Error {
  readonly code = 'CODEX_SPAWN_TIMEOUT' as const
  constructor(agentId: string) {
    super(`Codex agent ${agentId} did not start within ${SPAWN_READY_TIMEOUT_MS}ms`)
    this.name = 'CodexSpawnTimeout'
  }
}

/**
 * Options for seeding the per-agent Codex config.
 *   - trustedDir: pre-record `[projects."<dir>"] trust_level = "trusted"` so the
 *     interactive TUI skips its first-run "Decide how much autonomy" / folder-
 *     trust wizard. This is the exact artifact the wizard writes once accepted;
 *     a fresh per-agent CODEX_HOME has no entry, so without this the wizard
 *     fires on every conversation launch and blocks the pane.
 *   - approvalPolicy / sandboxMode: autonomy for interactive conversations,
 *     derived from the Overdeck yolo setting. Headless `codex exec` overrides
 *     these via -c/-s flags at launch, so the defaults here only matter for TUI.
 *
 * In addition to the config seeding, this copies the user's global Codex
 * credential (~/.codex/auth.json) into the per-agent CODEX_HOME. A fresh home
 * with no auth.json makes Codex render its blocking sign-in onboarding
 * ("Welcome to Codex … Sign in with ChatGPT … Press enter to continue") on
 * every launch — which never writes a rollout, so nothing surfaces in the
 * conversation view and the user is forced through the auth flow each time.
 * Seeding auth is the credential analog of seeding folder trust above.
 */
export interface InitCodexHomeOpts {
  trustedDir?: string
  approvalPolicy?: string
  sandboxMode?: string
  approvalsReviewer?: string
}

/**
 * Create the per-agent CODEX_HOME directory layout:
 *   <codexHomeDir>/
 *     config.toml   — Codex settings (approval_policy, sandbox_mode, project
 *                     trust, notify hooks)
 *     AGENTS.md     — Populated by context-layering bead; placeholder for now
 *     sessions/     — Codex writes rollout JSONL here
 */
export function initCodexHome(codexHomeDir: string, opts: InitCodexHomeOpts = {}): void {
  mkdirSync(join(codexHomeDir, 'sessions'), { recursive: true, mode: 0o700 })

  const configPath = join(codexHomeDir, 'config.toml')
  // Always (re)write config.toml so permission-mode changes take effect on
  // resume. The file is Overdeck-managed ("do not edit manually") and
  // contains no user state — only launch-time settings.
  {
    // Codex config keys are flat top-level scalars, NOT TOML table sections:
    // `model`/`approval_policy`/`sandbox_mode` are strings and `notify` is a
    // single argv array. model/provider is set at launch via the -m flag, so it
    // is omitted here. (Writing `[model]` as a table makes Codex fail config
    // load with "invalid type: map, expected a string in `model`".)
    const notifyHookPath = join(homedir(), '.overdeck', 'bin', 'codex-notify-hook')
    const lines = [
      '# Overdeck-managed Codex config — do not edit manually',
      '# model/provider set at launch via -m flag',
      '',
      `approval_policy = "${opts.approvalPolicy ?? 'never'}"`,
    ]
    if (opts.sandboxMode) {
      lines.push(`sandbox_mode = "${opts.sandboxMode}"`)
    }
    if (opts.approvalsReviewer) {
      lines.push(`approvals_reviewer = "${opts.approvalsReviewer}"`)
    }
    if (existsSync(notifyHookPath)) {
      lines.push(`notify = ["node", "${notifyHookPath}"]`)
    }
    if (opts.trustedDir) {
      // Pre-seed folder trust so the TUI skips its first-run autonomy wizard.
      // TOML basic-string key: escape backslashes and double-quotes in the path.
      const escaped = opts.trustedDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      lines.push('', `[projects."${escaped}"]`, 'trust_level = "trusted"')
    }
    lines.push('')
    writeFileSync(configPath, lines.join('\n'), { mode: 0o600 })
  }

  // Seed auth so Codex skips its blocking sign-in onboarding on a fresh home.
  // Copy the global ~/.codex/auth.json once, only when this home has none —
  // Codex keeps its own copy refreshed thereafter, so on resume we must not
  // clobber a newer token with a staler global one. Best-effort: if the user
  // has never signed in to Codex globally there is nothing to copy, and the
  // onboarding will (correctly) prompt for a real first-time login.
  const homeAuthPath = join(codexHomeDir, 'auth.json')
  if (!existsSync(homeAuthPath)) {
    const globalAuthPath = join(homedir(), '.codex', 'auth.json')
    if (existsSync(globalAuthPath)) {
      copyFileSync(globalAuthPath, homeAuthPath)
      // auth.json holds OAuth access/refresh tokens — keep it private.
      try { chmodSync(homeAuthPath, 0o600) } catch { /* best-effort */ }
    }
  }

  const agentsMdPath = join(codexHomeDir, 'AGENTS.md')
  if (!existsSync(agentsMdPath)) {
    // Seed from the pre-rendered Codex global context layer if available;
    // fall back to a placeholder. The static file is written by `pan sync`
    // via syncContextLayersSync → renderGlobalLayer('codex', …).
    const globalCodexContext = join(homedir(), '.overdeck', 'context', 'codex-global.md')
    if (existsSync(globalCodexContext)) {
      copyFileSync(globalCodexContext, agentsMdPath)
    } else {
      writeFileSync(agentsMdPath, '# Overdeck Agent Instructions\n\n<!-- run `pan sync` to populate -->\n', { mode: 0o644 })
    }
  }
}

/**
 * Translate Overdeck's abstract sandbox mode token into a value the codex
 * CLI actually accepts. Overdeck config uses 'workspace' as its mode name
 * (see config-yaml.ts permission modes); codex only accepts read-only,
 * workspace-write, danger-full-access. Passing the abstract token raw made
 * `codex exec -s workspace` exit instantly with an invalid-value error, which
 * killed every codex work agent ~13s after spawn (PAN-1799).
 */
export function toCodexSandboxValue(mode: string | undefined): string {
  const valid = new Set(['read-only', 'workspace-write', 'danger-full-access'])
  if (mode && valid.has(mode)) return mode
  if (mode === 'read_only') return 'read-only'
  // 'workspace', undefined, and anything unrecognized → the safe writable default.
  return 'workspace-write'
}

/**
 * Poll $CODEX_HOME/sessions/**\/*.jsonl for a new rollout file.
 * Returns the rollout path once one appears, or null on timeout.
 * Prefers the user thread over subagent (guardian) rollouts so the captured
 * thread-id always identifies the main conversation (PAN-1805).
 */
export async function waitForCodexRollout(codexHomeDir: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const rollout = findLatestRollout(codexHomeDir)
    if (rollout) return rollout
    await new Promise(r => setTimeout(r, 200))
  }
  return null
}

/**
 * Extract the thread-id from a rollout filename.
 *
 * Codex names rollouts `rollout-<timestamp>-<threadId>.jsonl`, where threadId
 * is the session UUID (8-4-4-4-12) — e.g.
 * `rollout-2026-06-09T01-47-53-019eaaec-4dfa-7ab1-90ba-9104d16534d1.jsonl`
 * → `019eaaec-4dfa-7ab1-90ba-9104d16534d1`. Extract the trailing UUID;
 * splitting on `-` and taking the last segment truncates the id to its final
 * group, which breaks `codex exec resume <threadId>` and findRolloutPath.
 */
export function extractThreadIdFromRollout(rolloutPath: string): string | null {
  const name = basename(rolloutPath, '.jsonl')
  const m = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  return m ? m[1]! : null
}

/**
 * Read the first line (the session_meta record) of a rollout file without
 * loading the whole multi-megabyte JSONL.
 */
function readRolloutMetaLine(path: string, maxBytes = 131072): string | null {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    return null
  }
  try {
    const buf = Buffer.alloc(maxBytes)
    const n = readSync(fd, buf, 0, maxBytes, 0)
    const text = buf.subarray(0, n).toString('utf-8')
    const nl = text.indexOf('\n')
    return nl === -1 ? text : text.slice(0, nl)
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}

/**
 * True when a rollout belongs to a Codex-internal subagent thread (e.g. the
 * guardian approval supervisor), per the session_meta `thread_source` field.
 * Subagent rollouts live in the same per-agent CODEX_HOME as the main thread
 * and are written concurrently, so raw mtime cannot tell them apart
 * (PAN-1805). Unknown/unparseable meta is treated as a user thread — older
 * Codex versions predate `thread_source`.
 */
function isSubagentRollout(path: string): boolean {
  const line = readRolloutMetaLine(path)
  if (!line) return false
  try {
    const meta = JSON.parse(line) as { payload?: { thread_source?: unknown } }
    return meta.payload?.thread_source === 'subagent'
  } catch {
    return false
  }
}

/**
 * Return the most-recently-modified *user-thread* rollout JSONL under
 * <codexHomeDir>/sessions, or null. A per-conversation/-agent CODEX_HOME holds
 * only that session's rollouts, so the newest user thread is its current
 * conversation. Subagent (guardian) rollouts are skipped — they interleave
 * writes with the main thread and would otherwise win the mtime race
 * (PAN-1805). Used to resolve the transcript when no thread-id was persisted —
 * the spawn-time capture is a one-shot window, but Codex only writes its
 * rollout on the first turn.
 */
export function findLatestRollout(codexHomeDir: string): string | null {
  const sessionsRoot = join(codexHomeDir, 'sessions')
  const paths: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      const full = join(dir, entry)
      let isDir = false
      try { isDir = statSync(full).isDirectory() } catch { continue }
      if (isDir) walk(full)
      else if (entry.startsWith('rollout-') && entry.endsWith('.jsonl')) paths.push(full)
    }
  }
  walk(sessionsRoot)
  const byMtimeDesc = paths
    .map((p) => {
      try { return { p, mtimeMs: statSync(p).mtimeMs } } catch { return null }
    })
    .filter((e): e is { p: string; mtimeMs: number } => e !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const { p } of byMtimeDesc) {
    if (!isSubagentRollout(p)) return p
  }
  // All rollouts are subagent threads — better to show one than nothing.
  return byMtimeDesc[0]?.p ?? null
}

// ─── Sync runtime ─────────────────────────────────────────────────────────────

export class CodexRuntimeSync implements AgentRuntimeSync {
  readonly name = 'codex' as const

  getHarnessBehavior(): HarnessBehavior {
    return CODEX_BEHAVIOR
  }

  getSessionPath(agentId: string): string | null {
    const threadId = readThreadId(agentId)
    if (!threadId) return null
    // Use per-agent CODEX_HOME, not the global ~/.codex; each agent's rollouts
    // are written to ~/.overdeck/agents/<id>/codex-home/sessions/.
    return findRolloutPath(join(agentDirFor(agentId), 'codex-home'), threadId)
  }

  getLastActivity(agentId: string): Date | null {
    const path = this.getSessionPath(agentId)
    if (!path) return null
    try {
      return statSync(path).mtime
    } catch {
      return null
    }
  }

  getHeartbeat(agentId: string): Heartbeat | null {
    // Tier 1: Fresh notify-written heartbeat (<60s old).
    const heartbeatPath = join(homedir(), '.overdeck', 'heartbeats', `${agentId}.json`)
    if (existsSync(heartbeatPath)) {
      try {
        const data = JSON.parse(readFileSync(heartbeatPath, 'utf-8')) as {
          timestamp?: string
          tool_name?: string
          last_action?: string
          thread_id?: string
        }
        if (data.timestamp) {
          const ts = new Date(data.timestamp)
          if (Date.now() - ts.getTime() < 60_000) {
            return {
              timestamp: ts,
              agentId,
              source: 'active-heartbeat',
              confidence: 'high',
              toolName: data.tool_name,
              lastAction: data.last_action,
            }
          }
        }
      } catch {
        // fall through
      }
    }

    // Tier 2: Rollout JSONL mtime.
    const lastActivity = this.getLastActivity(agentId)
    if (lastActivity) {
      return {
        timestamp: lastActivity,
        agentId,
        source: 'jsonl',
        confidence: 'medium',
      }
    }

    // Tier 3: tmux session creation time.
    try {
      const sess = listSessionsSync().find(s => s.name === agentId)
      if (sess) {
        return {
          timestamp: sess.created,
          agentId,
          source: 'tmux',
          confidence: 'low',
        }
      }
    } catch {
      // ignore
    }
    return null
  }

  getTokenUsage(agentId: string): TokenUsage | null {
    const path = this.getSessionPath(agentId)
    if (!path) return null
    const parsed = parseCodexSessionSync(path)
    return parsed?.usage ?? null
  }

  getSessionCost(agentId: string): CostBreakdown | null {
    const path = this.getSessionPath(agentId)
    if (!path) return null
    const parsed = parseCodexSessionSync(path)
    if (!parsed) return null
    return {
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      totalCost: parsed.cost_v2 ?? parsed.cost ?? 0,
      currency: 'USD',
    }
  }

  /**
   * Deliver a follow-up message to a running Codex agent via `codex exec resume`.
   * D-2 phase 1: one-shot exec-resume per orchestrator message (no app-server).
   *
   * Note: `codex exec resume` rejects -s; set sandbox via -c sandbox_mode=read-only.
   */
  async sendMessage(agentId: string, message: string): Promise<void> {
    const threadId = readThreadId(agentId)
    if (!threadId) {
      throw new Error(`Codex agent ${agentId}: no captured thread-id — cannot send message`)
    }
    const codexHomeDir = join(agentDirFor(agentId), 'codex-home')
    const cmd = `CODEX_HOME=${shellQuote(codexHomeDir)} codex exec resume -c sandbox_mode=read-only ${shellQuote(threadId)} ${shellQuote(message)}`
    await execAsync(cmd)
  }

  /**
   * Kill a Codex agent via a SIGTERM→SIGKILL escalation ladder.
   *
   *   1. Send Ctrl-C to the tmux pane (interrupt running task).
   *   2. Wait up to 2s for the session to disappear.
   *   3. SIGTERM the codex process group via pkill.
   *   4. Wait up to 5s for the session to disappear.
   *   5. tmux kill-session (SIGKILL fallback).
   *
   * NEVER deletes rollout JSONL files under $CODEX_HOME/sessions/ — per the
   * JSONL-is-sacred rule.
   */
  async killAgent(agentId: string): Promise<void> {
    // Step 1: interrupt the running task.
    try {
      await execAsync(`tmux -L overdeck send-keys -t ${shellQuote(agentId)} C-c 2>/dev/null || true`)
    } catch {
      // ignore
    }

    // Step 2: poll up to 2s.
    if (await pollUntilSessionGone(agentId, 2_000)) return

    // Step 3: SIGTERM the pane process group via tmux.
    // OVERDECK_AGENT_ID is an env var, not an argv argument, so pkill -f
    // won't match it. Instead, resolve the pane PID from tmux and kill the
    // process group directly.
    try {
      const { stdout } = await execAsync(
        `tmux -L overdeck list-panes -t ${shellQuote(agentId)} -F '#{pane_pid}' 2>/dev/null`
      )
      const pid = stdout.trim()
      if (pid) await execAsync(`kill -TERM -- -${pid} 2>/dev/null || kill -TERM ${pid} 2>/dev/null || true`)
    } catch {
      // ignore
    }

    // Step 4: poll up to 5s more (7s total).
    if (await pollUntilSessionGone(agentId, 5_000)) return

    // Step 5: SIGKILL via kill-session.
    if (await Effect.runPromise(sessionExists(agentId))) {
      await Effect.runPromise(killSession(agentId))
    }
  }

  async spawnAgent(config: SpawnConfig & { codexHome?: string; codexSandboxMode?: string }): Promise<Agent> {
    const agentId = config.agentId

    // Per-agent CODEX_HOME: ~/.overdeck/agents/<id>/codex-home
    const codexHomeDir = config.codexHome ?? join(homedir(), '.overdeck', 'agents', agentId, 'codex-home')

    // 1. Create CODEX_HOME structure (config.toml + AGENTS.md + sessions/).
    initCodexHome(codexHomeDir)

    // 2. Build the codex exec command — shell-quote every interpolated value.
    const sandbox = toCodexSandboxValue(config.codexSandboxMode)
    const tokens: string[] = ['codex', 'exec']
    if (config.model) tokens.push('-m', shellQuote(config.model))
    tokens.push('-c', 'approval_policy=never')
    tokens.push('-s', shellQuote(sandbox))
    tokens.push('--skip-git-repo-check')
    if (config.prompt) tokens.push(shellQuote(config.prompt))

    const fullCmd = `CODEX_HOME=${shellQuote(codexHomeDir)} ${tokens.join(' ')}`

    // 3. Launch the tmux session on the overdeck socket.
    await Effect.runPromise(createSession(agentId, config.workspace, fullCmd, {
      env: {
        OVERDECK_AGENT_ID: agentId,
        CODEX_HOME: codexHomeDir,
      },
    }))

    // 4. Wait for the rollout JSONL to appear (readiness signal).
    const rolloutPath = await waitForCodexRollout(codexHomeDir, SPAWN_READY_TIMEOUT_MS)
    if (!rolloutPath) {
      throw new CodexSpawnTimeout(agentId)
    }

    // 5. Capture thread-id from the rollout filename and persist it.
    const threadId = extractThreadIdFromRollout(rolloutPath)
    if (threadId) {
      writeThreadId(agentId, threadId)
    }

    return {
      id: agentId,
      sessionId: threadId ?? 'unknown',
      runtime: 'codex',
      model: config.model ?? 'codex-4o',
      workspace: config.workspace,
      startedAt: new Date(),
    }
  }

  listSessions(_workspace?: string): Session[] {
    const sessions: Session[] = []
    const sessionsRoot = join(codexHome(), 'sessions')
    if (!existsSync(sessionsRoot)) return sessions
    collectRollouts(sessionsRoot, sessions)
    return sessions
  }

  async isRunning(agentId: string): Promise<boolean> {
    return await Effect.runPromise(sessionExists(agentId))
  }
}

async function pollUntilSessionGone(agentId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await Effect.runPromise(sessionExists(agentId)))) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}

function collectRollouts(dir: string, out: Session[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      collectRollouts(full, out)
    } else if (entry.startsWith('rollout-') && entry.endsWith('.jsonl')) {
      // Use the canonical extractor so dashed UUIDs are handled correctly.
      const threadId = extractThreadIdFromRollout(full) ?? ''
      try {
        const mtime = statSync(full).mtime
        out.push({
          id: threadId,
          agentId: 'unknown',
          workspace: 'unknown',
          model: 'unknown',
          startedAt: mtime,
          lastActivity: mtime,
          tokenUsage: { inputTokens: 0, outputTokens: 0 },
        })
      } catch {
        // skip unreadable entries
      }
    }
  }
}

export function createCodexRuntimeSync(): CodexRuntimeSync {
  return new CodexRuntimeSync()
}

// ─── Effect variant ────────────────────────────────────────────────────────────

export class CodexRuntime implements AgentRuntime {
  readonly name = 'codex' as const
  private readonly inner: CodexRuntimeSync

  constructor(inner: CodexRuntimeSync = new CodexRuntimeSync()) {
    this.inner = inner
  }

  getSessionPath(agentId: string): string | null {
    return this.inner.getSessionPath(agentId)
  }
  getHarnessBehavior(): HarnessBehavior {
    return this.inner.getHarnessBehavior()
  }
  getLastActivity(agentId: string): Date | null {
    return this.inner.getLastActivity(agentId)
  }
  getHeartbeat(agentId: string): Heartbeat | null {
    return this.inner.getHeartbeat(agentId)
  }
  getTokenUsage(agentId: string): TokenUsage | null {
    return this.inner.getTokenUsage(agentId)
  }
  getSessionCost(agentId: string): CostBreakdown | null {
    return this.inner.getSessionCost(agentId)
  }
  listSessions(workspace?: string): Session[] {
    return this.inner.listSessions(workspace)
  }

  sendMessage(agentId: string, message: string): Effect.Effect<void, AgentRuntimeError> {
    return Effect.tryPromise({
      try: () => this.inner.sendMessage(agentId, message),
      catch: (cause) =>
        new TmuxError({
          command: 'codex-exec-resume',
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    })
  }

  killAgent(agentId: string): Effect.Effect<void, AgentRuntimeError> {
    return Effect.tryPromise({
      try: () => this.inner.killAgent(agentId),
      catch: (cause) =>
        new TmuxError({
          command: 'kill-session',
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    })
  }

  spawnAgent(config: SpawnConfig): Effect.Effect<Agent, AgentRuntimeError> {
    return Effect.tryPromise({
      try: () => this.inner.spawnAgent(config),
      catch: (cause) => {
        if (cause instanceof CodexSpawnTimeout) {
          return new ProcessTimeoutError({
            command: 'codex',
            args: ['exec'],
            timeoutMs: 60_000,
          })
        }
        return new ProcessSpawnError({
          command: 'codex',
          args: ['exec'],
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        })
      },
    })
  }

  isRunning(agentId: string): Effect.Effect<boolean> {
    return Effect.promise(() => this.inner.isRunning(agentId))
  }
}

export function createCodexRuntime(): CodexRuntime {
  return new CodexRuntime()
}
