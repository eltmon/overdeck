/**
 * Agent enrichment utilities (PAN-440 / PAN-1048)
 *
 * Shared functions for computing enrichment fields:
 *   role, hasPendingQuestion, pendingQuestionCount, resolution, resolutionCount
 *
 * Used by both the legacy REST /api/agents endpoint and the new
 * AgentEnrichmentService background poller.
 *
 * PAN-1048: replaced the legacy `agentPhase` string with the role primitive —
 * the dashboard derives label/status from `role` + lifecycle state.
 */

import { existsSync } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { encodeClaudeProjectDir } from './paths.js'
import { promisify } from 'util'
import { exec } from 'child_process'
import { Effect } from 'effect'
import { FsError } from './errors.js'
import { getAgentRuntimeState, getAgentDir, getAgentStateSync } from './agents.js'
import {
  detectAwaitingInputForAgent,
  normalizeAwaitingInputPrompt,
  type AwaitingInputDetection,
} from './agent-input-detection.js'
import { resolveProjectFromIssueSync } from './projects.js'
import { getGitHubConfig } from '../dashboard/server/services/tracker-config.js'
import { extractPrefixSync } from './issue-id.js'

const execAsync = promisify(exec)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuestionOption { label: string; description: string }
export interface Question { question: string; header: string; options: QuestionOption[]; multiSelect: boolean }
export interface PendingQuestion { toolId: string; timestamp: string; questions: Question[] }

/**
 * PAN-1520 — every "agent is blocked waiting on operator" surface we detect.
 * Used to drive the unified pending-input indicator and notifications.
 */
export type PendingInputKind =
  | 'askUserQuestion'
  | 'permissionRequest'
  | 'exitPlanMode'
  | 'enterPlanMode'
  | 'sessionResume'
  | 'rateLimit'

export interface PendingAskUserQuestionSnapshot {
  toolUseId: string
  askedAt: string
  questions: Array<{
    question: string
    header?: string
    multiSelect?: boolean
    options: Array<{ label: string; description?: string }>
  }>
}

export interface AgentEnrichment {
  role: 'plan' | 'work' | 'review' | 'test' | 'ship' | 'flywheel' | undefined
  hasPendingQuestion: boolean
  pendingQuestionCount: number
  pendingQuestionPrompt?: string
  pendingQuestionReason?: string
  // PAN-1520 — unified pending-input surfaces.
  pendingInputCount: number
  pendingInputKinds: PendingInputKind[]
  pendingAskUserQuestion?: PendingAskUserQuestionSnapshot
  resolution: string
  resolutionCount: number
}

// PAN-1520 / PAN-1834 — promote pane-detected blocking surfaces into the
// unified pending-input set so the indicator / needs-you list fires.
export function appendPaneDetectionKind(detection: AwaitingInputDetection | null, kinds: PendingInputKind[]): void {
  if (detection?.reason === 'session_resume' && !kinds.includes('sessionResume')) {
    kinds.push('sessionResume')
  }
  if (detection?.reason === 'rate_limit' && !kinds.includes('rateLimit')) {
    kinds.push('rateLimit')
  }
}

// PAN-1834 — an agent that IS the active specialist (review/test/ship) must
// still surface its own pending-input. Only suppress the parked work/plan agent
// when another specialist is active on the same issue.
export function isOwnActiveSpecialist(role: AgentEnrichment['role']): boolean {
  return role === 'review' || role === 'test' || role === 'ship'
}

// ─── JSONL path helpers ───────────────────────────────────────────────────────

export function getClaudeProjectDir(workspacePath: string): string {
  return join(homedir(), '.claude', 'projects', encodeClaudeProjectDir(workspacePath))
}

export async function getActiveSessionPath(projectDir: string): Promise<string | null> {
  if (!existsSync(projectDir)) return null
  try {
    const entries = await readdir(projectDir)
    const jsonlFiles = entries.filter(f => f.endsWith('.jsonl'))
    if (jsonlFiles.length === 0) return null
    // Claude Code rotates/renames JSONL session files, so a file present at
    // readdir() can vanish before stat(). Stat each file independently and DROP
    // the ones that disappear — never let a single ENOENT reject the whole batch
    // and collapse the result to null. (PAN: the null path made the
    // complete-planning pending-AskUserQuestion guard scan nothing → it
    // completed planning while the operator's question was still open.)
    const withMtime = (
      await Promise.all(
        jsonlFiles.map(async f => {
          try {
            return { name: f, path: join(projectDir, f), mtime: (await stat(join(projectDir, f))).mtime.getTime() }
          } catch {
            return null
          }
        }),
      )
    ).filter((x): x is { name: string; path: string; mtime: number } => x !== null)
    if (withMtime.length === 0) return null
    withMtime.sort((a, b) => b.mtime - a.mtime)
    return withMtime[0].path
  } catch {
    return null
  }
}

function getProjectPathByPrefix(issuePrefix: string): string {
  const issueId = `${issuePrefix}-1`
  const resolved = resolveProjectFromIssueSync(issueId)
  if (resolved) return resolved.projectPath
  const config = getGitHubConfig()
  if (config) {
    for (const { owner, repo, prefix } of config.repos) {
      const repoPrefix = prefix || repo.toUpperCase().replace(/-CLI$/, '').replace(/-/g, '')
      if (repoPrefix.toUpperCase() === issuePrefix.toUpperCase()) {
        const possiblePaths = [
          join(homedir(), 'Projects', repo),
          join(homedir(), 'Projects', repo.replace(/-cli$/, '')),
          join(homedir(), 'Projects', owner, repo),
        ]
        for (const path of possiblePaths) {
          if (existsSync(path)) return path
        }
      }
    }
  }
  return join(homedir(), 'Projects')
}async function getAgentWorkspacePromise(agentId: string): Promise<string | null> {
  const workspace = getAgentStateSync(agentId)?.workspace;
  if (workspace) return workspace;
  try {
    const { stdout: paneCwd } = await execAsync(
      `tmux display-message -t ${agentId} -p '#{pane_current_path}' 2>/dev/null`,
      { encoding: 'utf-8' }
    )
    const trimmed = paneCwd.trim()
    if (trimmed && existsSync(trimmed)) return trimmed
  } catch {}
  const issueId = agentId.replace(/^(agent-|planning-)/, '').toUpperCase()
  const prefix = extractPrefixSync(issueId)
  if (!prefix) return null
  try {
    const projectPath = getProjectPathByPrefix(prefix)
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`)
    if (existsSync(workspacePath)) return workspacePath
    return projectPath
  } catch {
    return null
  }
}async function getAgentJsonlPathPromise(agentId: string): Promise<string | null> {
  const workspace = await Effect.runPromise(getAgentWorkspace(agentId))
  if (!workspace) return null
  const projectDir = getClaudeProjectDir(workspace)
  return await getActiveSessionPath(projectDir)
}

/**
 * Count outstanding AskUserQuestions across ALL of an agent's workspace JSONL
 * session files — not just the newest one. Claude Code rotates session files,
 * so an open AskUserQuestion can sit in a file that is not the most-recently-
 * modified. The complete-planning guard MUST be robust to that: scanning only
 * the active file let TIN-1 complete planning while the operator's question was
 * still open. Returns 0 only when no file has an unanswered AUQ.
 */
async function countPendingAskUserQuestionsForAgentPromise(agentId: string): Promise<number> {
  const workspace = await Effect.runPromise(getAgentWorkspace(agentId))
  if (!workspace) return 0
  const projectDir = getClaudeProjectDir(workspace)
  if (!existsSync(projectDir)) return 0
  let files: string[]
  try {
    files = (await readdir(projectDir)).filter(f => f.endsWith('.jsonl'))
  } catch {
    return 0
  }
  let total = 0
  for (const f of files) {
    try {
      const scan = await scanPendingInputsPromise(join(projectDir, f))
      total += scan.askUserQuestions.length
    } catch {
      // A file vanishing mid-scan (rotation) is not "no question" — but we
      // can't read it, so skip it; other files still contribute.
    }
  }
  return total
}

/** Effect-native: count pending AskUserQuestions across all of an agent's JSONL files. */
export const countPendingAskUserQuestionsForAgent = (
  agentId: string,
): Effect.Effect<number> =>
  Effect.promise(() => countPendingAskUserQuestionsForAgentPromise(agentId))

// ─── JSONL scanning ───────────────────────────────────────────────────────────

/**
 * Read the last `maxBytes` from a file. Efficient for large JSONL files where
 * only recent entries (at the end) are relevant.
 */
async function readFileTail(filePath: string, maxBytes: number): Promise<string> {
  try {
    const fileStat = await stat(filePath)
    const start = Math.max(0, fileStat.size - maxBytes)
    // For fs/promises readFile we can't specify start offset directly,
    // so use a stream approach for large files.
    if (start === 0) {
      return readFile(filePath, 'utf-8')
    }
    const { createReadStream } = await import('node:fs')
    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath, { start, encoding: 'utf-8' })
      let data = ''
      stream.on('data', chunk => { data += chunk })
      stream.on('end', () => resolve(data))
      stream.on('error', reject)
    })
  } catch {
    return ''
  }
}/**
 * PAN-1520 — the hook (`sync-sources/hooks/ask-user-question-hook`) returns a
 * deny verdict with this reason string. When we see a tool_result whose content
 * matches this, treat it as a "still pending" — the operator has NOT actually
 * answered; the upstream tool was denied to force a plain-text restate.
 */
const ASK_USER_QUESTION_HOOK_DENY_MARKER = 'PAN-1520'

function isAskUserQuestionHookDenyToolResult(item: { content?: unknown; is_error?: unknown }): boolean {
  if (item.is_error !== true) return false
  const content = item.content
  if (typeof content === 'string') return content.includes(ASK_USER_QUESTION_HOOK_DENY_MARKER)
  if (Array.isArray(content)) {
    return content.some((part: unknown) => {
      if (typeof part === 'string') return part.includes(ASK_USER_QUESTION_HOOK_DENY_MARKER)
      if (part && typeof part === 'object' && 'text' in part) {
        const text = (part as { text?: unknown }).text
        return typeof text === 'string' && text.includes(ASK_USER_QUESTION_HOOK_DENY_MARKER)
      }
      return false
    })
  }
  return false
}

async function getPendingQuestionsPromise(jsonlPath: string): Promise<PendingQuestion[]> {
  const detection = await scanPendingInputsPromise(jsonlPath)
  return detection.askUserQuestions
}

export interface PendingInputsScan {
  readonly askUserQuestions: PendingQuestion[]
  /** Outstanding EnterPlanMode tool_use ids without a matching ExitPlanMode (plan being drafted). */
  readonly enterPlanModeOpen: boolean
  /** Outstanding ExitPlanMode tool_use without a matching tool_result (operator approval pending). */
  readonly exitPlanModePending: boolean
}

/**
 * PAN-1520 — does this user-message entry carry operator text (i.e. an answer)
 * rather than just being a wrapper for a tool_result? When the hook denies an
 * AskUserQuestion the agent restates the question as plain text; the operator's
 * next user message — whether typed in the terminal, sent from the conversation
 * composer, or delivered by the answer-question route — is the actual answer.
 * The presence of that user-text turn after the deny is what resolves the AUQ.
 */
function isUserTextEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false
  const e = entry as { type?: unknown; message?: { content?: unknown } }
  if (e.type !== 'user') return false
  const content = e.message?.content
  if (typeof content === 'string') return content.trim().length > 0
  if (Array.isArray(content)) {
    return content.some((item: unknown) => {
      if (!item || typeof item !== 'object') return false
      const t = (item as { type?: unknown }).type
      // Anything that's not a tool_result counts as operator text (text blocks,
      // image blocks pasted by the operator, etc.).
      return t !== 'tool_result'
    })
  }
  return false
}

export async function scanPendingInputsPromise(jsonlPath: string): Promise<PendingInputsScan> {
  if (!existsSync(jsonlPath)) {
    return { askUserQuestions: [], enterPlanModeOpen: false, exitPlanModePending: false }
  }
  try {
    // Only read the last 512KB — pending inputs are always recent.
    const content = await readFileTail(jsonlPath, 512_000)
    const lines = content.split('\n').filter(line => line.trim())
    const askToolCalls = new Map<string, PendingQuestion>()
    const askAnswered = new Set<string>()
    // PAN-1520 — AUQs the hook denied but the operator hasn't yet answered as
    // plain text. The next user-text turn resolves all of them.
    const askDeniedAwaitingUser = new Set<string>()
    const exitPlanModeIds = new Set<string>()
    const exitPlanModeAnswered = new Set<string>()
    const enterPlanModeIds = new Set<string>()
    const exitPlanModeFiredAfterEnter = new Set<string>() // tracks any ExitPlanMode (signals plan-mode session ended)

    for (const line of lines) {
      try {
        const entry = JSON.parse(line)

        // PAN-1520 — a user-text turn resolves any AUQs still in the "denied
        // but awaiting operator response" state. Without this check, an AUQ
        // that was hook-denied and then answered via the dashboard modal (or
        // by the operator typing in the terminal) would appear pending forever.
        if (isUserTextEntry(entry)) {
          for (const id of askDeniedAwaitingUser) askAnswered.add(id)
          askDeniedAwaitingUser.clear()
        }

        const messageContent = entry.message?.content
        if (!Array.isArray(messageContent)) continue
        for (const item of messageContent) {
          if (item.type === 'tool_use') {
            if (item.name === 'AskUserQuestion' && typeof item.id === 'string') {
              askToolCalls.set(item.id, {
                toolId: item.id,
                timestamp: entry.timestamp || new Date().toISOString(),
                questions: item.input?.questions || [],
              })
            } else if (item.name === 'ExitPlanMode' && typeof item.id === 'string') {
              exitPlanModeIds.add(item.id)
              exitPlanModeFiredAfterEnter.add(item.id)
            } else if (item.name === 'EnterPlanMode' && typeof item.id === 'string') {
              enterPlanModeIds.add(item.id)
            }
          }
          if (item.type === 'tool_result' && typeof item.tool_use_id === 'string') {
            if (askToolCalls.has(item.tool_use_id)) {
              if (isAskUserQuestionHookDenyToolResult(item)) {
                // Hook deny — mark as "waiting on operator text" so the very
                // next user-text turn clears it.
                askDeniedAwaitingUser.add(item.tool_use_id)
              } else {
                askAnswered.add(item.tool_use_id)
                askDeniedAwaitingUser.delete(item.tool_use_id)
              }
            }
            if (exitPlanModeIds.has(item.tool_use_id)) {
              exitPlanModeAnswered.add(item.tool_use_id)
            }
          }
        }
      } catch { /* malformed JSONL line — skip */ }
    }

    const askUserQuestions = Array.from(askToolCalls.entries())
      .filter(([id]) => !askAnswered.has(id))
      .map(([, question]) => question)

    const exitPlanModePending = Array.from(exitPlanModeIds).some(id => !exitPlanModeAnswered.has(id))

    // EnterPlanMode is "open" only if no ExitPlanMode has fired since the last
    // EnterPlanMode. Approximation: if there are EnterPlanMode ids AND no
    // ExitPlanMode has fired, we're still in plan mode.
    const enterPlanModeOpen = enterPlanModeIds.size > 0 && exitPlanModeFiredAfterEnter.size === 0

    return { askUserQuestions, enterPlanModeOpen, exitPlanModePending }
  } catch {
    return { askUserQuestions: [], enterPlanModeOpen: false, exitPlanModePending: false }
  }
}async function getAgentPendingQuestionsPromise(agentId: string): Promise<PendingQuestion[]> {
  const jsonlPath = await Effect.runPromise(getAgentJsonlPath(agentId))
  if (!jsonlPath) return []
  return [...(await Effect.runPromise(getPendingQuestions(jsonlPath)))]
}

async function getAgentJsonlMtimePromise(agentId: string): Promise<number | null> {
  const jsonlPath = await Effect.runPromise(getAgentJsonlPath(agentId))
  if (!jsonlPath || !existsSync(jsonlPath)) return null
  try {
    return (await stat(jsonlPath)).mtime.getTime()
  } catch {
    return null
  }
}async function computeAgentEnrichmentPromise(
  agentId: string,
  startedAt?: string,
  hasActiveSpecialist?: boolean,
  skipJsonlScan?: boolean,
): Promise<AgentEnrichment> {
  const isPlanning = agentId.startsWith('planning-')

  // Read persisted role for enrichment projection.
  const stateRole = getAgentStateSync(agentId)?.role

  const role: AgentEnrichment['role'] =
    (stateRole === 'plan' || stateRole === 'work' || stateRole === 'review' ||
     stateRole === 'test' || stateRole === 'ship' || stateRole === 'flywheel')
      ? stateRole
      : (isPlanning ? 'plan' : undefined)

  // Get runtime state for resolution + explicit waiting signals.
  const runtimeState = await Effect.runPromise(getAgentRuntimeState(agentId))

  // Get pending questions + other blocking surfaces, filtered by agent start time.
  // Skip JSONL scan when mtime is unchanged (optimization for static TUI sessions).
  let pendingQuestions: PendingQuestion[] = []
  let enterPlanModeOpen = false
  let exitPlanModePending = false
  if (!skipJsonlScan) {
    const jsonlPath = await Effect.runPromise(getAgentJsonlPath(agentId))
    if (jsonlPath) {
      const scan = await scanPendingInputsPromise(jsonlPath)
      pendingQuestions = [...scan.askUserQuestions]
      enterPlanModeOpen = scan.enterPlanModeOpen
      exitPlanModePending = scan.exitPlanModePending
    }
    if (pendingQuestions.length > 0 && startedAt) {
      const agentStartTime = new Date(startedAt).getTime()
      pendingQuestions = pendingQuestions.filter(q => {
        const qTime = new Date(q.timestamp).getTime()
        return !isNaN(qTime) && qTime >= agentStartTime
      })
    }
  }

  const questionDetection: AwaitingInputDetection | null = pendingQuestions.length > 0
    ? {
        reason: 'user_question',
        prompt: normalizeAwaitingInputPrompt(
          pendingQuestions[0]?.questions
            .map(q => q.question)
            .filter(Boolean)
            .join('\n') || 'Agent is waiting for a user answer',
        ),
      }
    : null

  const runtimeDetection: AwaitingInputDetection | null = runtimeState?.state === 'waiting-on-human'
    ? {
        reason: (runtimeState.waitingReason as AwaitingInputDetection['reason']) || 'other',
        prompt: normalizeAwaitingInputPrompt(
          runtimeState.waitingNotification || 'Agent is waiting for human input',
        ),
      }
    : null

  const paneDetection = !questionDetection && !runtimeDetection
    ? await Effect.runPromise(detectAwaitingInputForAgent(agentId, { isPlanning }))
    : null

  const fallbackDetection: AwaitingInputDetection | null = runtimeState?.resolution === 'needs_input'
    ? {
        reason: 'other',
        prompt: normalizeAwaitingInputPrompt('Agent stopped because it needs human input or hit a blocker'),
      }
    : null

  const detection = questionDetection ?? runtimeDetection ?? paneDetection ?? fallbackDetection
  const shouldSuppressPendingInput = hasActiveSpecialist === true && !isOwnActiveSpecialist(role)
  const hasPendingQuestion = !shouldSuppressPendingInput && detection !== null

  // PAN-1520 — fold every blocking surface into a uniform set.
  // PermissionRequest is tracked server-side in channelPermissionRequestsById and
  // is contributed at the read-model layer (server merges it in). The enrichment
  // here owns the JSONL-derived kinds plus pane/runtime fallbacks.
  const pendingInputKinds: PendingInputKind[] = []
  let pendingAskUserQuestion: PendingAskUserQuestionSnapshot | undefined
  if (!shouldSuppressPendingInput) {
    if (pendingQuestions.length > 0) {
      pendingInputKinds.push('askUserQuestion')
      const first = pendingQuestions[0]
      pendingAskUserQuestion = {
        toolUseId: first.toolId,
        askedAt: first.timestamp,
        questions: first.questions.map(q => ({
          question: q.question,
          header: q.header,
          multiSelect: q.multiSelect,
          options: q.options.map(o => ({ label: o.label, description: o.description })),
        })),
      }
    }
    if (exitPlanModePending) pendingInputKinds.push('exitPlanMode')
    if (enterPlanModeOpen && !exitPlanModePending) pendingInputKinds.push('enterPlanMode')
    // PAN-1520 (covers #1197) — promote pane-detected session-resume dialogs
    // into the unified pending-input set so the indicator fires.
    // PAN-1834 — also promote pane-detected rate-limit / model-switch modals.
    appendPaneDetectionKind(detection, pendingInputKinds)
  }

  return {
    role,
    hasPendingQuestion,
    pendingQuestionCount: pendingQuestions.length,
    pendingQuestionPrompt: detection?.prompt,
    pendingQuestionReason: detection?.reason,
    pendingInputCount: pendingInputKinds.length,
    pendingInputKinds,
    pendingAskUserQuestion,
    resolution: runtimeState?.resolution || 'working',
    resolutionCount: runtimeState?.resolutionCount || 0,
  }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect-native variant of computeAgentEnrichment. Fails with FsError if any
 * underlying filesystem read fails outside the swallowed branches.
 */
export const computeAgentEnrichment = (
  agentId: string,
  startedAt?: string,
  hasActiveSpecialist?: boolean,
  skipJsonlScan?: boolean,
): Effect.Effect<AgentEnrichment, FsError> =>
  Effect.tryPromise({
    try: () => computeAgentEnrichmentPromise(agentId, startedAt, hasActiveSpecialist, skipJsonlScan),
    catch: (cause) =>
      new FsError({
        path: getAgentDir(agentId),
        operation: 'computeAgentEnrichment',
        cause,
      }),
  })

/** Effect-native: resolve the workspace path for an agent (null on failure). */
export const getAgentWorkspace = (
  agentId: string,
): Effect.Effect<string | null> =>
  Effect.promise(() => getAgentWorkspacePromise(agentId))

/** Effect-native: resolve the active JSONL session path for an agent (null on failure). */
export const getAgentJsonlPath = (
  agentId: string,
): Effect.Effect<string | null> =>
  Effect.promise(() => getAgentJsonlPathPromise(agentId))

/** Effect-native: get the mtime of the agent's active JSONL session file. */
export const getAgentJsonlMtime = (
  agentId: string,
): Effect.Effect<number | null> =>
  Effect.promise(() => getAgentJsonlMtimePromise(agentId))

/** Effect-native: parse pending questions from a JSONL file. */
export const getPendingQuestions = (
  jsonlPath: string,
): Effect.Effect<readonly PendingQuestion[]> =>
  Effect.promise(() => getPendingQuestionsPromise(jsonlPath))

/** Effect-native: get pending questions for an agent by id. */
export const getAgentPendingQuestions = (
  agentId: string,
): Effect.Effect<readonly PendingQuestion[]> =>
  Effect.promise(() => getAgentPendingQuestionsPromise(agentId))
