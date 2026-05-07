/**
 * @panopticon/pi-extension (PAN-636)
 *
 * Vendored extension loaded by the Pi Coding Agent (`pi --extension <path>`)
 * to emit Panopticon lifecycle signals via filesystem markers.
 *
 * The extension writes to two roots, both under HOME:
 *   ~/.panopticon/agents/<agentId>/
 *     ready.json     — written on session_start. Carries the Pi session id
 *                      so PiRuntime.killAgent / resume can locate it.
 *     completed      — touched when the agent invokes `/pan-done`. Acts as
 *                      the "agent says it's finished" marker that Cloister
 *                      polls before waking the review specialist.
 *   ~/.panopticon/heartbeats/<agentId>.json
 *     timestamp/tool/pid — refreshed on every tool_execution_end and
 *                          turn_end so the dashboard health monitor knows
 *                          the agent is still alive.
 *
 * agentId comes EXCLUSIVELY from process.env.PANOPTICON_AGENT_ID. We never
 * default — an extension running outside Panopticon (e.g. the user starts pi
 * directly with -e for testing) just no-ops. This guarantees two extension
 * instances launched with different agent ids never collide on either path.
 */

import { mkdir, writeFile } from 'node:fs/promises'
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
  }
}

async function writeJson(path: string, body: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
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
  await mkdir(paths.agentDir, { recursive: true })
  await writeJson(paths.readyPath, {
    agentId: env.agentId,
    sessionId: event.sessionId ?? null,
    reason: event.reason ?? 'unknown',
    timestamp: now(),
    pid: env.pid ?? process.pid,
  })
}

export async function handleToolExecutionEnd(env: HookEnv, event: ToolExecutionEndEvent): Promise<void> {
  const { paths, pid, now } = envFor(env)
  await mkdir(paths.heartbeatsDir, { recursive: true })
  await writeJson(paths.heartbeatPath, {
    agent_id: env.agentId,
    timestamp: now(),
    tool_name: event.toolName ?? 'unknown',
    last_action: event.isError ? 'tool_error' : 'tool_end',
    pid,
  })
}

export async function handleTurnEnd(env: HookEnv, _event: TurnEndEvent): Promise<void> {
  const { paths, pid, now } = envFor(env)
  await mkdir(paths.heartbeatsDir, { recursive: true })
  await writeJson(paths.heartbeatPath, {
    agent_id: env.agentId,
    timestamp: now(),
    tool_name: 'turn_end',
    last_action: 'turn_end',
    pid,
  })
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
      // Filesystem failures must never break Pi.
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
