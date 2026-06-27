/**
 * @overdeck/ohmypi-extension (PAN-1989)
 *
 * Vendored extension loaded by oh-my-pi (`omp --extension <path>`)
 * to emit Overdeck lifecycle signals via filesystem markers and HTTP POSTs.
 * Forked from @overdeck/pi-extension (PAN-636, PAN-1134).
 */

import { watch, type FSWatcher } from 'node:fs'
import { appendFile, mkdir, open, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { matchSpecialistCompletion, normalizeSpecialistCompletionName } from './specialist-completion-patterns.js'

export interface OhmypiExtensionAPI {
  on(event: 'session_start', handler: (event: SessionStartEvent, ctx: unknown) => void | Promise<void>): void
  on(event: 'tool_execution_end', handler: (event: ToolExecutionEndEvent, ctx: unknown) => void | Promise<void>): void
  on(event: 'turn_end', handler: (event: TurnEndEvent, ctx: unknown) => void | Promise<void>): void
  on(event: 'input', handler: (event: InputEvent, ctx: unknown) => void | Promise<void>): void
  on(event: string, handler: (event: unknown, ctx: unknown) => void | Promise<void>): void
  registerCommand(name: string, command: OhmypiCommand): void
  sendUserMessage?(content: string, options?: SendUserMessageOptions): void | Promise<void>
  setThinkingLevel?(level: ThinkingLevel): void | Promise<void>
  getThinkingLevel?(): ThinkingLevel | Promise<ThinkingLevel>
  setModel?(model: string): void | Promise<void>
  exec?(command: string, args?: string[], options?: Record<string, unknown>): unknown | Promise<unknown>
}

/** @deprecated Use OhmypiExtensionAPI */
export type PiExtensionAPI = OhmypiExtensionAPI

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface SendUserMessageOptions {
  deliverAs?: 'steer' | 'followUp'
}

export interface InputEvent {
  source?: 'interactive' | 'rpc' | 'extension'
  text?: string
}

export interface ExtensionContext {
  compact?(options?: Record<string, unknown>): void | Promise<void>
}

export interface OhmypiExtensionCapabilities {
  sendUserMessage: boolean
  setThinkingLevel: boolean
  getThinkingLevel: boolean
  setModel: boolean
  exec: boolean
  compact: boolean
}

export type ControlCommand =
  | {
      id: string
      type: 'prompt' | 'steer' | 'follow_up'
      message: string
      source: 'operator' | 'orchestrator'
    }
  | {
      id: string
      type: 'set_thinking_level'
      level: ThinkingLevel
    }
  | {
      id: string
      type: 'set_model'
      model: string
    }
  | {
      id: string
      type: 'compact'
    }

export interface ControlAck {
  id: string
  ok: boolean
  error?: string
}

function hasFunction(value: unknown, name: string): boolean {
  return typeof (value as Record<string, unknown> | null | undefined)?.[name] === 'function'
}

export function probeOhmypiExtensionCapabilities(runtime: unknown, ctx?: unknown): OhmypiExtensionCapabilities {
  return {
    sendUserMessage: hasFunction(runtime, 'sendUserMessage'),
    setThinkingLevel: hasFunction(runtime, 'setThinkingLevel'),
    getThinkingLevel: hasFunction(runtime, 'getThinkingLevel'),
    setModel: hasFunction(runtime, 'setModel'),
    exec: hasFunction(runtime, 'exec'),
    compact: hasFunction(ctx, 'compact'),
  }
}

export async function setThinkingLevelIfSupported(runtime: unknown, level: ThinkingLevel): Promise<boolean> {
  const setThinkingLevel = (runtime as OhmypiExtensionAPI | null | undefined)?.setThinkingLevel
  if (typeof setThinkingLevel !== 'function') return false
  await setThinkingLevel.call(runtime, level)
  return true
}

export interface SessionStartEvent {
  reason?: string
  sessionId?: string
}

export interface UsageLike {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
}

export interface ToolExecutionEndEvent {
  toolCallId?: string
  toolName?: string
  isError?: boolean
  usage?: UsageLike | null
  costUsd?: number | null
  cost?: number | null
  model?: string
}

export interface TurnEndEvent {
  reason?: string
  output?: string
  transcript?: string
  sessionLogPath?: string
  usage?: UsageLike | null
  costUsd?: number | null
  cost?: number | null
  model?: string
}

export interface OhmypiCommand {
  description?: string
  handler: (args: string, ctx: unknown) => void | Promise<void>
}

/** @deprecated Use OhmypiCommand */
export type PiCommand = OhmypiCommand

export interface OverdeckPaths {
  agentDir: string
  heartbeatsDir: string
  readyPath: string
  completedPath: string
  heartbeatPath: string
  sessionIdPath: string
  pendingEventsPath: string
  costEventsPath: string
  progressStatePath: string
  controlDir: string
}

export function overdeckPathsFor(agentId: string, home: string = homedir()): OverdeckPaths {
  const agentDir = join(home, '.overdeck', 'agents', agentId)
  const heartbeatsDir = join(home, '.overdeck', 'heartbeats')
  return {
    agentDir,
    heartbeatsDir,
    readyPath: join(agentDir, 'ready.json'),
    completedPath: join(agentDir, 'completed'),
    heartbeatPath: join(heartbeatsDir, `${agentId}.json`),
    sessionIdPath: join(agentDir, 'session.id'),
    pendingEventsPath: join(agentDir, 'pending-events.jsonl'),
    costEventsPath: join(agentDir, 'cost-events.jsonl'),
    progressStatePath: join(agentDir, 'pi-progress.json'),
    controlDir: join(agentDir, 'control'),
  }
}

async function writeJson(path: string, body: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
}

const POST_TIMEOUT_MS = 1_000
const MAX_PENDING_EVENTS = 200
const MAX_PENDING_EVENT_BYTES = 256_000
const MAX_PENDING_DRAIN_EVENTS = 25
const MAX_TURN_OUTPUT_BYTES = 64_000
const INTERNAL_TOKEN_HEADER = 'x-overdeck-internal-token'
const HEARTBEAT_PATH = (agentId: string) => `/api/agents/${agentId}/heartbeat`
const CONVERSATION_CONTROL_ACK_PATH = (agentId: string) => `/api/conversations/${encodeURIComponent(agentId)}/control-ack`

function getDashboardUrl(): string {
  return process.env['OVERDECK_DASHBOARD_URL'] ?? 'http://localhost:3011'
}

async function readInternalToken(env: HookEnv): Promise<string | null> {
  const fromEnv = process.env['OVERDECK_INTERNAL_TOKEN']
  if (fromEnv?.trim()) return fromEnv.trim()
  const overdeckHome = env.home ? join(env.home, '.overdeck') : (process.env['OVERDECK_HOME'] || join(homedir(), '.overdeck'))
  try {
    const token = (await readFile(join(overdeckHome, 'internal-token'), 'utf8')).trim()
    return token.length > 0 ? token : null
  } catch {
    return null
  }
}

async function postEvent(env: HookEnv, body: Record<string, unknown>): Promise<void> {
  await postDashboard(env, HEARTBEAT_PATH(env.agentId), body)
}

async function postDashboard(env: HookEnv, path: string, body: Record<string, unknown>): Promise<void> {
  const url = `${getDashboardUrl()}${path}`
  const paths = overdeckPathsFor(env.agentId, env.home)
  await drainPendingEvents(env, paths.pendingEventsPath)

  const ok = await postWithTimeout(env, url, body)
  if (ok) return

  if (ok === false) {
    await mkdir(paths.agentDir, { recursive: true })
    await appendFile(paths.pendingEventsPath, `${JSON.stringify(path === HEARTBEAT_PATH(env.agentId) ? body : { __overdeckPath: path, body })}\n`, 'utf8').catch(() => {})
  }
}

async function postWithTimeout(env: HookEnv, url: string, body: Record<string, unknown>): Promise<boolean | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS)
  try {
    const token = await readInternalToken(env)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers[INTERNAL_TOKEN_HEADER] = token
    const res = await fetch(url, {
      method: 'POST',
      headers,
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

async function postJsonWithTimeout(env: HookEnv, url: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS)
  try {
    const token = await readInternalToken(env)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers[INTERNAL_TOKEN_HEADER] = token
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) return null
    return await res.json() as Record<string, unknown>
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function readPendingEventLines(pendingPath: string): Promise<string[]> {
  let raw: string
  try {
    const info = await stat(pendingPath)
    if (info.size <= MAX_PENDING_EVENT_BYTES) {
      raw = await readFile(pendingPath, 'utf8')
    } else {
      const bytesToRead = Math.min(info.size, MAX_PENDING_EVENT_BYTES)
      const file = await open(pendingPath, 'r')
      try {
        const buffer = Buffer.alloc(bytesToRead)
        await file.read(buffer, 0, bytesToRead, info.size - bytesToRead)
        raw = buffer.toString('utf8')
        const firstNewline = raw.indexOf('\n')
        if (firstNewline >= 0) raw = raw.slice(firstNewline + 1)
      } finally {
        await file.close()
      }
    }
  } catch {
    return []
  }

  return raw
    .split('\n')
    .filter((line) => line.trim())
    .slice(-MAX_PENDING_EVENTS)
}

async function writePendingEventLines(pendingPath: string, lines: string[], env: HookEnv): Promise<void> {
  if (lines.length === 0) return
  const paths = overdeckPathsFor(env.agentId, env.home)
  await mkdir(paths.agentDir, { recursive: true })
  await writeFile(pendingPath, lines.slice(-MAX_PENDING_EVENTS).map((line) => `${line}\n`).join(''), 'utf8').catch(() => {})
}

async function drainPendingEvents(env: HookEnv, pendingPath: string): Promise<void> {
  const lines = await readPendingEventLines(pendingPath)
  await unlink(pendingPath).catch(() => {})
  if (lines.length === 0) return

  const remaining: string[] = []
  const limit = Math.min(lines.length, MAX_PENDING_DRAIN_EVENTS)

  for (let i = 0; i < limit; i++) {
    const line = lines[i]!
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    const path = typeof parsed['__overdeckPath'] === 'string'
      ? parsed['__overdeckPath'] as string
      : HEARTBEAT_PATH(env.agentId)
    const body = parsed['body'] && typeof parsed['body'] === 'object'
      ? parsed['body'] as Record<string, unknown>
      : parsed

    const ok = await postWithTimeout(env, `${getDashboardUrl()}${path}`, body)
    if (ok || ok === null) continue
    remaining.push(line, ...lines.slice(i + 1))
    break
  }

  if (remaining.length === 0 && limit < lines.length) {
    remaining.push(...lines.slice(limit))
  }

  await writePendingEventLines(pendingPath, remaining, env)
}

export interface HookEnv {
  agentId: string
  home?: string
  pid?: number
  now?: () => string
  role?: string
  issueId?: string
  workspace?: string
  sessionLogPath?: string
  stuckTurnThreshold?: number
}

function envFor(env: HookEnv): {
  paths: OverdeckPaths
  pid: number
  now: () => string
} {
  return {
    paths: overdeckPathsFor(env.agentId, env.home),
    pid: env.pid ?? process.pid,
    now: env.now ?? (() => new Date().toISOString()),
  }
}

async function readAgentState(env: HookEnv): Promise<Record<string, unknown>> {
  const { paths } = envFor(env)
  try {
    return JSON.parse(await readFile(join(paths.agentDir, 'state.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function issueIdFor(env: HookEnv): Promise<string | null> {
  if (env.issueId) return env.issueId.toUpperCase()
  if (process.env['OVERDECK_ISSUE_ID']) return process.env['OVERDECK_ISSUE_ID']!.toUpperCase()
  const state = await readAgentState(env)
  const fromState = state['issueId'] ?? state['currentIssue']
  if (typeof fromState === 'string' && fromState.trim()) return fromState.toUpperCase()
  const match = env.agentId.match(/(?:agent-)?([a-z]+)-(\d+)/i)
  return match ? `${match[1]!.toUpperCase()}-${match[2]}` : null
}

async function workspaceFor(env: HookEnv): Promise<string | null> {
  if (env.workspace) return env.workspace
  if (process.env['OVERDECK_WORKSPACE']) return process.env['OVERDECK_WORKSPACE']!
  const state = await readAgentState(env)
  return typeof state['workspace'] === 'string' && state['workspace'].trim() ? state['workspace'] : null
}

async function sessionIdFor(env: HookEnv): Promise<string | null> {
  const { paths } = envFor(env)
  try {
    const sessionId = (await readFile(paths.sessionIdPath, 'utf8')).trim()
    return sessionId.length > 0 ? sessionId : null
  } catch {
    return null
  }
}

function roleFor(env: HookEnv): string {
  return env.role ?? process.env['OVERDECK_AGENT_ROLE'] ?? process.env['OVERDECK_SESSION_TYPE'] ?? ''
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function extractUsage(event: { usage?: UsageLike | null }): { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } | null {
  const usage = event.usage
  if (!usage) return null
  return {
    inputTokens: usageNumber(usage.inputTokens ?? usage.input_tokens),
    outputTokens: usageNumber(usage.outputTokens ?? usage.output_tokens),
    cacheReadTokens: usageNumber(usage.cacheReadTokens ?? usage.cache_read_tokens),
    cacheWriteTokens: usageNumber(usage.cacheWriteTokens ?? usage.cache_write_tokens),
  }
}

async function recordCostEvent(env: HookEnv, event: ToolExecutionEndEvent | TurnEndEvent, tool: string, timestamp: string): Promise<void> {
  const { paths } = envFor(env)
  const issueId = await issueIdFor(env)
  const usage = extractUsage(event)
  const costUsd = typeof event.costUsd === 'number'
    ? event.costUsd
    : typeof event.cost === 'number'
      ? event.cost
      : null
  const body = {
    kind: 'cost-event',
    agentId: env.agentId,
    issueId,
    agentRole: roleFor(env) || undefined,
    tool,
    model: event.model ?? 'pi',
    usage,
    costUsd,
    timestamp,
  }

  await mkdir(paths.agentDir, { recursive: true })
  await appendFile(paths.costEventsPath, `${JSON.stringify(body)}\n`, 'utf8').catch(() => {})
  await postEvent(env, body)
}

function isClosedBead(issue: Record<string, unknown>): boolean {
  const status = String(issue['status'] ?? '').toLowerCase()
  return status === 'closed' || status === 'done' || status === 'completed'
}

function beadMatchesIssue(issue: Record<string, unknown>, issueId: string): boolean {
  const label = issueId.toLowerCase()
  const labels = Array.isArray(issue['labels']) ? issue['labels'] : []
  return labels.some((entry) => String(entry).toLowerCase() === label)
    || String(issue['title'] ?? '').toLowerCase().includes(issueId.toLowerCase())
    || String(issue['id'] ?? '').toLowerCase().includes(issueId.toLowerCase())
}

async function allIssueBeadsClosed(workspace: string, issueId: string): Promise<boolean> {
  let raw = ''
  try {
    raw = await readFile(join(workspace, '.beads', 'issues.jsonl'), 'utf8')
  } catch {
    return false
  }
  const issues = raw.split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try { return JSON.parse(line) as Record<string, unknown> } catch { return null }
    })
    .filter((issue): issue is Record<string, unknown> => !!issue && beadMatchesIssue(issue, issueId))

  return issues.length > 0 && issues.every(isClosedBead)
}

function statusComplete(value: unknown): boolean {
  return String(value ?? '').toLowerCase() === 'completed'
}

function planItemsComplete(plan: Record<string, unknown>): boolean {
  const root = (plan['plan'] && typeof plan['plan'] === 'object') ? plan['plan'] as Record<string, unknown> : plan
  const items = Array.isArray(root['items']) ? root['items'] as Record<string, unknown>[] : []
  if (items.length === 0) return true
  return items.every((item) => {
    const subItems = Array.isArray(item['subItems']) ? item['subItems'] as Record<string, unknown>[] : []
    return statusComplete(item['status']) && subItems.every((subItem) => statusComplete(subItem['status']))
  })
}

async function vbriefSatisfied(workspace: string): Promise<boolean> {
  for (const path of [join(workspace, '.pan', 'spec.vbrief.json'), join(workspace, '.pan', 'continue.json')]) {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
      if (!planItemsComplete(parsed)) return false
      return true
    } catch {}
  }
  return true
}

async function evidenceClean(env: HookEnv): Promise<boolean> {
  const issueId = await issueIdFor(env)
  const workspace = await workspaceFor(env)
  if (!issueId || !workspace) return false
  return await allIssueBeadsClosed(workspace, issueId) && await vbriefSatisfied(workspace)
}

async function readTurnOutput(env: HookEnv, event: TurnEndEvent): Promise<string> {
  if (event.output?.trim()) return event.output.slice(-MAX_TURN_OUTPUT_BYTES)
  if (event.transcript?.trim()) return event.transcript.slice(-MAX_TURN_OUTPUT_BYTES)
  const path = event.sessionLogPath ?? env.sessionLogPath ?? process.env['OVERDECK_PI_SESSION_LOG']
  if (!path) return ''
  try {
    const contents = await readFile(path, 'utf8')
    return contents.slice(-MAX_TURN_OUTPUT_BYTES)
  } catch {
    return ''
  }
}

async function postWorkComplete(env: HookEnv, reason: string, summary: string): Promise<void> {
  const issueId = await issueIdFor(env)
  await postDashboard(env, `/api/agents/${env.agentId}/work-complete`, { issueId, reason, summary })
  await postEvent(env, { kind: 'resolution_set', resolution: 'done', resolutionCount: 1 })
}

async function classifyCompletion(env: HookEnv, output: string): Promise<string | null> {
  const issueId = await issueIdFor(env)
  const result = await postJsonWithTimeout(env, `${getDashboardUrl()}/api/agents/${env.agentId}/classify-completion`, { issueId, output })
  return typeof result?.['verdict'] === 'string' ? result['verdict'] as string : null
}

async function markStuck(env: HookEnv, reason: string): Promise<void> {
  const issueId = await issueIdFor(env)
  await postDashboard(env, `/api/agents/${env.agentId}/stuck`, { issueId, reason })
  await postEvent(env, { kind: 'resolution_set', resolution: 'stuck', resolutionCount: 1 })
}

const COMPLETION_PHRASES = [
  'Implementation complete',
  'all beads closed',
  'ready for review',
  'work complete',
]

function hasStructuredCompletionMarker(output: string): boolean {
  if (/\bOVERDECK_WORK_COMPLETE\b/i.test(output)) return true

  for (const phrase of COMPLETION_PHRASES) {
    const pattern = new RegExp(phrase.replace(/ /g, '\\s+'), 'ig')
    for (const match of output.matchAll(pattern)) {
      const index = match.index ?? 0
      const prefix = output.slice(Math.max(0, index - 48), index).toLowerCase()
      if (/\b(not|never|no|cannot|can't|blocked|waiting|needs input|not yet|isn't|aren't)\b/.test(prefix)) {
        continue
      }
      return true
    }
  }

  return false
}

async function updateProgress(env: HookEnv, kind: 'tool' | 'turn', timestamp: string, extra: Record<string, unknown> = {}): Promise<number> {
  const { paths } = envFor(env)
  let previous: Record<string, unknown> = {}
  try {
    previous = JSON.parse(await readFile(paths.progressStatePath, 'utf8')) as Record<string, unknown>
  } catch {}
  const previousCount = typeof previous['progresslessTurns'] === 'number' ? previous['progresslessTurns'] : 0
  const nextCount = kind === 'tool' ? 0 : previousCount + 1
  await mkdir(paths.agentDir, { recursive: true })
  await writeJson(paths.progressStatePath, { ...previous, ...extra, lastEvent: kind, lastUpdated: timestamp, progresslessTurns: nextCount })
  return nextCount
}

export async function handleWorkAgentTurnEnd(env: HookEnv, event: TurnEndEvent): Promise<void> {
  const output = await readTurnOutput(env, event)
  if (await evidenceClean(env)) {
    await postWorkComplete(env, 'evidence-clean', 'All issue beads are closed and the plan is satisfied')
    return
  }

  if (hasStructuredCompletionMarker(output)) {
    await postWorkComplete(env, 'structured-reply', output.slice(-1000))
    return
  }

  const verdict = output.trim() ? await classifyCompletion(env, output) : null
  if (verdict === 'FORGOT_COMPLETION' || verdict === 'done') {
    await postWorkComplete(env, 'classifier', output.slice(-1000))
    return
  }
  if (verdict === 'STOPPED_FOR_INPUT' || verdict === 'needs_input') {
    await postEvent(env, { kind: 'resolution_set', resolution: 'needs_input', resolutionCount: 1 })
    return
  }

  const turns = await updateProgress(env, 'turn', envFor(env).now())
  const threshold = env.stuckTurnThreshold ?? Number(process.env['OVERDECK_PI_STUCK_TURN_THRESHOLD'] ?? 3)
  if (turns >= threshold) {
    await markStuck(env, `No completion or progress detected after ${turns} Pi turn_end events`)
  }
}

export async function handleSpecialistTurnEnd(env: HookEnv, event: TurnEndEvent): Promise<void> {
  const role = roleFor(env)
  const output = await readTurnOutput(env, event)
  const match = matchSpecialistCompletion(role, output)
  if (!match) return
  const issueId = await issueIdFor(env)
  if (!issueId) return
  await postDashboard(env, `/api/specialists/${match.name}/auto-complete`, {
    agentId: env.agentId,
    issueId,
    role,
    sessionId: await sessionIdFor(env),
    status: match.status,
    notes: match.summary,
  })
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
  if (event.sessionId) {
    await writeFile(paths.sessionIdPath, `${event.sessionId}\n`, 'utf8')
  }
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
  await updateProgress(env, 'tool', ts, { lastToolCallId: event.toolCallId ?? null })
  await postEvent(env, { kind: 'activity', activity: 'working', tool: event.toolName ?? 'unknown', timestamp: ts })
  await recordCostEvent(env, event, event.toolName ?? 'unknown', ts)
}

export async function handleTurnEnd(env: HookEnv, event: TurnEndEvent): Promise<void> {
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
  await postEvent(env, { kind: 'activity', activity: 'idle', timestamp: ts })
  await recordCostEvent(env, event, 'turn_end', ts)

  const role = roleFor(env)
  if (role === 'work') {
    await handleWorkAgentTurnEnd(env, event)
  } else if (normalizeSpecialistCompletionName(role)) {
    await handleSpecialistTurnEnd(env, event)
  }
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

export async function handleWorkspaceContext(ctx: unknown, cwd: string = process.cwd()): Promise<void> {
  await appendSystemPromptFile(ctx, join(cwd, '.pan', 'context', 'workspace.md'))
}

export async function handleSessionBriefingContext(
  ctx: unknown,
  home: string = process.env['OVERDECK_HOME'] || join(homedir(), '.overdeck'),
): Promise<void> {
  await appendSystemPromptFile(ctx, join(home, 'session-context.md'))
}

/**
 * Load the rendered global context layer (PAN-1566) and fold it into the
 * Pi session's system prompt.
 *
 * `pan sync` renders the global layer (~/.overdeck/context/global.md +
 * bundled engineering rules) into ~/.overdeck/context/pi-global.md so Pi
 * sessions receive the same engineering rules that Claude Code gets via
 * ~/.claude/CLAUDE.md.
 */
export async function handleGlobalContext(ctx: unknown): Promise<void> {
  const home = process.env['OVERDECK_HOME'] || join(homedir(), '.overdeck')
  await appendSystemPromptFile(ctx, join(home, 'context', 'pi-global.md'))
}

async function postControlAck(env: HookEnv, ack: ControlAck): Promise<void> {
  await postDashboard(env, CONVERSATION_CONTROL_ACK_PATH(env.agentId), { ...ack })
}

function isControlCommand(value: unknown): value is ControlCommand {
  const record = value as Record<string, unknown> | null
  if (!record || typeof record !== 'object') return false
  if (typeof record['id'] !== 'string' || typeof record['type'] !== 'string') return false
  switch (record['type']) {
    case 'prompt':
    case 'steer':
    case 'follow_up':
      return typeof record['message'] === 'string' &&
        (record['source'] === 'operator' || record['source'] === 'orchestrator')
    case 'set_thinking_level':
      return record['level'] === 'off' ||
        record['level'] === 'minimal' ||
        record['level'] === 'low' ||
        record['level'] === 'medium' ||
        record['level'] === 'high' ||
        record['level'] === 'xhigh'
    case 'set_model':
      return typeof record['model'] === 'string'
    case 'compact':
      return true
    default:
      return false
  }
}

export async function dispatchControlCommand(
  env: HookEnv,
  omp: OhmypiExtensionAPI,
  ctx: unknown,
  command: ControlCommand,
): Promise<ControlAck> {
  try {
    switch (command.type) {
      case 'prompt':
        if (typeof omp.sendUserMessage !== 'function') return { id: command.id, ok: false, error: 'sendUserMessage unsupported' }
        await omp.sendUserMessage(command.message)
        return { id: command.id, ok: true }
      case 'steer':
        if (typeof omp.sendUserMessage !== 'function') return { id: command.id, ok: false, error: 'sendUserMessage unsupported' }
        await omp.sendUserMessage(command.message, { deliverAs: 'steer' })
        return { id: command.id, ok: true }
      case 'follow_up':
        if (typeof omp.sendUserMessage !== 'function') return { id: command.id, ok: false, error: 'sendUserMessage unsupported' }
        await omp.sendUserMessage(command.message, { deliverAs: 'followUp' })
        return { id: command.id, ok: true }
      case 'set_thinking_level': {
        const ok = await setThinkingLevelIfSupported(omp, command.level)
        return ok ? { id: command.id, ok: true } : { id: command.id, ok: false, error: 'setThinkingLevel unsupported' }
      }
      case 'set_model':
        if (typeof omp.setModel !== 'function') return { id: command.id, ok: false, error: 'setModel unsupported' }
        await omp.setModel(command.model)
        return { id: command.id, ok: true }
      case 'compact': {
        const compact = (ctx as ExtensionContext | null | undefined)?.compact
        if (typeof compact !== 'function') return { id: command.id, ok: false, error: 'compact unsupported' }
        await compact.call(ctx)
        return { id: command.id, ok: true }
      }
    }
  } catch (err) {
    return { id: command.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function processControlCommandFile(
  env: HookEnv,
  omp: OhmypiExtensionAPI,
  ctx: unknown,
  file: string,
): Promise<void> {
  let idForAck: string | null = null
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isControlCommand(parsed)) {
      console.warn(`[overdeck-ohmypi-extension] malformed control command ignored: ${file}`)
      return
    }
    idForAck = parsed.id
    const ack = await dispatchControlCommand(env, omp, ctx, parsed)
    await postControlAck(env, ack)
  } catch (err) {
    console.warn(`[overdeck-ohmypi-extension] failed to process control command ${file}:`, err)
    if (idForAck) {
      await postControlAck(env, { id: idForAck, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  } finally {
    await unlink(file).catch(() => {})
  }
}

export async function drainConversationControlCommands(
  env: HookEnv,
  omp: OhmypiExtensionAPI,
  ctx: unknown,
): Promise<void> {
  const paths = overdeckPathsFor(env.agentId, env.home)
  await mkdir(paths.controlDir, { recursive: true, mode: 0o700 })
  const entries = await readdir(paths.controlDir).catch(() => [])
  for (const entry of entries.filter((name) => name.endsWith('.json')).sort()) {
    await processControlCommandFile(env, omp, ctx, join(paths.controlDir, entry))
  }
}

export async function handleInputEvent(env: HookEnv, event: InputEvent): Promise<void> {
  await postEvent(env, {
    kind: 'conversation_input',
    source: event.source ?? 'unknown',
    timestamp: env.now ? env.now() : new Date().toISOString(),
  })
}

export async function handleConversationControlSessionStart(
  env: HookEnv,
  omp: OhmypiExtensionAPI,
  ctx: unknown,
): Promise<FSWatcher> {
  const paths = overdeckPathsFor(env.agentId, env.home)
  await mkdir(paths.controlDir, { recursive: true, mode: 0o700 })
  await drainConversationControlCommands(env, omp, ctx)
  const watcher = watch(paths.controlDir, (_event, filename) => {
    if (!filename || !filename.endsWith('.json')) return
    void processControlCommandFile(env, omp, ctx, join(paths.controlDir, filename)).catch((err) => {
      console.warn(`[overdeck-ohmypi-extension] control watcher failed for ${filename}:`, err)
    })
  })
  return watcher
}

async function appendSystemPromptFile(ctx: unknown, file: string): Promise<void> {
  const content = await readFile(file, 'utf8').catch(() => '')
  if (!content.trim()) return
  const append = (ctx as { appendSystemPrompt?: unknown } | null | undefined)?.appendSystemPrompt
  if (typeof append === 'function') {
    try {
      await append.call(ctx, content)
    } catch {}
  }
}

export default function overdeckOhmypiExtension(omp: OhmypiExtensionAPI): void {
  const agentId = process.env['OVERDECK_AGENT_ID']
  if (!agentId) return

  const env: HookEnv = { agentId }

  omp.on('session_start', async (event, ctx) => {
    try {
      await handleSessionStart(env, event)
      // PAN-1566: fold the global engineering-rules layer into the prompt.
      await handleGlobalContext(ctx)
      // PAN-1201: fold the assembled workspace context layer into the prompt.
      await handleWorkspaceContext(ctx)
      await handleSessionBriefingContext(ctx)
      await handleConversationControlSessionStart(env, omp, ctx)
    } catch {}
  })

  omp.on('input', async event => {
    try {
      await handleInputEvent(env, event)
    } catch {}
  })

  omp.on('tool_execution_end', async event => {
    try {
      await handleToolExecutionEnd(env, event)
    } catch {}
  })

  omp.on('turn_end', async event => {
    try {
      await handleTurnEnd(env, event)
    } catch {}
  })

  omp.registerCommand('pan-done', {
    description: 'Signal Overdeck that this agent has completed its work.',
    handler: async args => {
      try {
        await handlePanDone(env, typeof args === 'string' ? args : '')
      } catch {}
    },
  })
}

/** @deprecated Use overdeckOhmypiExtension */
export { overdeckOhmypiExtension as overdeckPiExtension }
