/**
 * @panopticon/pi-extension (PAN-636, PAN-1134)
 *
 * Vendored extension loaded by the Pi Coding Agent (`pi --extension <path>`)
 * to emit Panopticon lifecycle signals via filesystem markers and HTTP POSTs.
 *
 * The extension writes to two roots, both under HOME:
 *   ~/.panopticon/agents/<agentId>/
 *     ready.json          — written on session_start. Carries the Pi session id
 *                           so PiRuntime.killAgent / resume can locate it.
 *     completed           — touched when the agent invokes `/pan-done`. Acts as
 *                           the "agent says it's finished" marker that Cloister
 *                           polls before waking the review specialist.
 *     pending-events.jsonl — buffered domain events when the dashboard is
 *                           unreachable. Drained automatically on the next
 *                           successful POST (PAN-1134).
 *   ~/.panopticon/heartbeats/<agentId>.json
 *     timestamp/tool/pid — refreshed on every tool_execution_end and
 *                          turn_end so the dashboard health monitor knows
 *                          the agent is still alive.
 *
 * Domain events flow through HTTP POST to /api/agents/:id/heartbeat, using
 * the same validation path as Claude Code hooks. POST failures buffer to
 * pending-events.jsonl and flush on retry — mirroring scripts/pan-hook-lib.sh.
 *
 * agentId comes EXCLUSIVELY from process.env.PANOPTICON_AGENT_ID. We never
 * default — an extension running outside Panopticon (e.g. the user starts pi
 * directly with -e for testing) just no-ops. This guarantees two extension
 * instances launched with different agent ids never collide on either path.
 */

import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ────────────────────────────────────────────────────────────────────────
// Pi extension API surface (subset). We type only what we touch so the
// extension can be built without adding @mariozechner/pi-coding-agent as a
// dependency — Pi loads us at runtime via dynamic import and supplies the
// real ExtensionAPI instance.
// ────────────────────────────────────────────────────────────────────────

export interface PiExtensionAPI {
  on(event: 'session_start', handler: (event: SessionStartEvent, ctx: unknown) => void | Promise<void>): void
  on(event: 'tool_execution_end', handler: (event: ToolExecutionEndEvent, ctx: unknown) => void | Promise<void>): void
  on(event: 'turn_end', handler: (event: TurnEndEvent, ctx: unknown) => void | Promise<void>): void
  on(event: string, handler: (event: unknown, ctx: unknown) => void | Promise<void>): void
  registerCommand(name: string, command: PiCommand): void
}

export interface SessionStartEvent {
  reason?: string
  sessionId?: string
}

export interface ToolExecutionEndEvent {
  toolCallId?: string
  toolName?: string
  isError?: boolean
}

export interface TurnEndEvent {
  reason?: string
}

export interface PiCommand {
  description?: string
  handler: (args: string, ctx: unknown) => void | Promise<void>
}

// ────────────────────────────────────────────────────────────────────────
// Filesystem layout helpers (exported for tests).
// ────────────────────────────────────────────────────────────────────────

export interface PanopticonPaths {
  agentDir: string
  heartbeatsDir: string
  readyPath: string
  completedPath: string
  heartbeatPath: string
  /**
   * Plain-text file holding ONLY the Pi session id reported by the most recent
   * spawn (PAN-636 workspace-3119). Survives killAgent so the next spawn can
   * resume into the same session via `pi --session <id>`.
   */
  sessionIdPath: string
  /**
   * Buffered domain events from POST failures. Drained on the next successful
   * POST (PAN-1134). Same FIFO model as scripts/pan-hook-lib.sh.
   */
  pendingEventsPath: string
}

export function panopticonPathsFor(agentId: string, home: string = homedir()): PanopticonPaths {
  const agentDir = join(home, '.panopticon', 'agents', agentId)
  const heartbeatsDir = join(home, '.panopticon', 'heartbeats')
  return {
    agentDir,
    heartbeatsDir,
    readyPath: join(agentDir, 'ready.json'),
    completedPath: join(agentDir, 'completed'),
    heartbeatPath: join(heartbeatsDir, `${agentId}.json`),
    sessionIdPath: join(agentDir, 'session.id'),
    pendingEventsPath: join(agentDir, 'pending-events.jsonl'),
  }
}

async function writeJson(path: string, body: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
}

// ────────────────────────────────────────────────────────────────────────
// HTTP event emitter — POSTs to the dashboard heartbeat endpoint.
// Same validation path as Claude Code hooks. Buffers on failure.
// ────────────────────────────────────────────────────────────────────────

const POST_TIMEOUT_MS = 1_000

function getDashboardUrl(): string {
  return process.env['PANOPTICON_DASHBOARD_URL'] ?? 'http://localhost:3010'
}

async function postEvent(env: HookEnv, body: Record<string, unknown>): Promise<void> {
  const url = `${getDashboardUrl()}/api/agents/${env.agentId}/heartbeat`
  const paths = panopticonPathsFor(env.agentId, env.home)
  const pendingPath = paths.pendingEventsPath

  // 1. Drain any previously-buffered events before emitting the new one.
  await drainPendingEvents(env, url, pendingPath)

  // 2. POST the new event.
  const ok = await postWithTimeout(url, body)
  if (ok) return

  // 3. On failure, buffer for retry. On 4xx (client error), drop — the
  // server told us this body is invalid and retrying won't help.
  if (ok === false) {
    // Network/5xx failure — buffer.
    const line = `${JSON.stringify(body)}\n`
    await mkdir(paths.agentDir, { recursive: true })
    await writeFile(pendingPath, line, { encoding: 'utf8', flag: 'a' }).catch(() => {
      // ignore write failure — event is lost, but extension must not block Pi.
    })
  }
  // ok === null means 4xx — drop silently.
}

/**
 * POST a single event body. Returns:
 *   true  — 2xx success
 *   false — network failure / timeout / 5xx (caller should buffer)
 *   null  — 4xx client error (caller should drop)
 */
async function postWithTimeout(url: string, body: Record<string, unknown>): Promise<boolean | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (res.status >= 200 && res.status < 300) return true
    if (res.status >= 400 && res.status < 500) return null
    return false
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Drain pending-events.jsonl in FIFO order. Reads the file, clears it,
 * then POSTs each line. If any POST fails, the remaining lines are written
 * back so they can be retried next time.
 */
async function drainPendingEvents(env: HookEnv, url: string, pendingPath: string): Promise<void> {
  let raw: string
  try {
    raw = await readFile(pendingPath, 'utf8')
  } catch {
    return
  }
  if (!raw.trim()) {
    await unlink(pendingPath).catch(() => { /* ignore */ })
    return
  }

  // Clear the file before posting so we don't double-deliver on crash.
  await unlink(pendingPath).catch(() => { /* ignore */ })

  const lines = raw.split('\n').filter((l) => l.trim())
  const remaining: string[] = []

  for (const line of lines) {
    let body: Record<string, unknown>
    try {
      body = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue // skip malformed line
    }

    const ok = await postWithTimeout(url, body)
    if (ok) {
      continue // drained successfully
    }
    if (ok === null) {
      continue // 4xx — drop
    }
    // Network failure — put this and the rest back.
    remaining.push(line)
  }

  if (remaining.length > 0) {
    const paths = panopticonPathsFor(env.agentId, env.home)
    await mkdir(paths.agentDir, { recursive: true })
    await writeFile(pendingPath, remaining.map((l) => `${l}\n`).join(''), { encoding: 'utf8' }).catch(() => {
      // ignore write failure
    })
  }
}

// ────────────────────────────────────────────────────────────────────────
// Hook implementations (exported for tests so we can drive each one in
// isolation without instantiating the real Pi runtime).
// ────────────────────────────────────────────────────────────────────────

export interface HookEnv {
  agentId: string
  home?: string
  pid?: number
  now?: () => string
}

function envFor(env: HookEnv): {
  paths: PanopticonPaths
  pid: number
  now: () => string
} {
  return {
    paths: panopticonPathsFor(env.agentId, env.home),
    pid: env.pid ?? process.pid,
    now: env.now ?? (() => new Date().toISOString()),
  }
}

export async function handleSessionStart(env: HookEnv, event: SessionStartEvent): Promise<void> {
  const { paths, now } = envFor(env)
  const ts = now()
  await mkdir(paths.agentDir, { recursive: true })
  await writeJson(paths.readyPath, {
    agentId: env.agentId,
    sessionId: event.sessionId ?? null,
    reason: event.reason ?? 'unknown',
    timestamp: ts,
    pid: env.pid ?? process.pid,
  })
  // Persist a plain-text session id so PiRuntime.spawnAgent can resume into
  // the same Pi session on the next spawn (PAN-636 workspace-3119). We write
  // this only when Pi gives us a sessionId — `null` would defeat resume.
  if (event.sessionId) {
    await writeFile(paths.sessionIdPath, `${event.sessionId}\n`, 'utf8')
  }
  // PAN-1134: POST domain events to the dashboard heartbeat endpoint.
  await postEvent(env, { kind: 'model_set', model: 'pi', claudeSessionId: event.sessionId ?? undefined, timestamp: ts })
  await postEvent(env, { kind: 'activity', activity: 'idle', timestamp: ts })
}

export async function handleToolExecutionEnd(env: HookEnv, event: ToolExecutionEndEvent): Promise<void> {
  const { paths, pid, now } = envFor(env)
  const ts = now()
  await mkdir(paths.heartbeatsDir, { recursive: true })
  await writeJson(paths.heartbeatPath, {
    agent_id: env.agentId,
    timestamp: ts,
    tool_name: event.toolName ?? 'unknown',
    last_action: event.isError ? 'tool_error' : 'tool_end',
    pid,
  })
  // PAN-1134: POST domain event so Pi agents show activity in the dashboard.
  await postEvent(env, { kind: 'activity', activity: 'working', tool: event.toolName ?? 'unknown', timestamp: ts })
}

export async function handleTurnEnd(env: HookEnv, _event: TurnEndEvent): Promise<void> {
  const { paths, pid, now } = envFor(env)
  const ts = now()
  await mkdir(paths.heartbeatsDir, { recursive: true })
  await writeJson(paths.heartbeatPath, {
    agent_id: env.agentId,
    timestamp: ts,
    tool_name: 'turn_end',
    last_action: 'turn_end',
    pid,
  })
  // PAN-1134: turn_end approximates the Claude Stop hook (agent back at prompt).
  await postEvent(env, { kind: 'activity', activity: 'idle', timestamp: ts })
}

export async function handlePanDone(env: HookEnv, args: string): Promise<void> {
  const { paths, now } = envFor(env)
  await mkdir(paths.agentDir, { recursive: true })
  await writeJson(paths.completedPath, {
    agentId: env.agentId,
    timestamp: now(),
    summary: args.trim() || null,
  })
}

// ────────────────────────────────────────────────────────────────────────
// Default export — registered with Pi via `pi --extension <dist/index.js>`.
// ────────────────────────────────────────────────────────────────────────

export default function panopticonPiExtension(pi: PiExtensionAPI): void {
  const agentId = process.env['PANOPTICON_AGENT_ID']
  if (!agentId) {
    // Running outside Panopticon (e.g. user testing pi directly with -e).
    // Stay silent: the extension MUST be a no-op so two parallel instances
    // without an agent id can never collide on heartbeat or ready files.
    return
  }

  const env: HookEnv = { agentId }

  pi.on('session_start', async event => {
    try {
      await handleSessionStart(env, event)
    } catch {
      // Filesystem / network failures must never break Pi.
    }
  })

  pi.on('tool_execution_end', async event => {
    try {
      await handleToolExecutionEnd(env, event)
    } catch {}
  })

  pi.on('turn_end', async event => {
    try {
      await handleTurnEnd(env, event)
    } catch {}
  })

  pi.registerCommand('pan-done', {
    description: 'Signal Panopticon that this agent has completed its work.',
    handler: async args => {
      try {
        await handlePanDone(env, typeof args === 'string' ? args : '')
      } catch {}
    },
  })
}
