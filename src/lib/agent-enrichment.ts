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
import { getAgentRuntimeState, getAgentDir } from './agents.js'
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

export interface AgentEnrichment {
  role: 'plan' | 'work' | 'review' | 'test' | 'ship' | 'flywheel' | undefined
  hasPendingQuestion: boolean
  pendingQuestionCount: number
  pendingQuestionPrompt?: string
  pendingQuestionReason?: string
  resolution: string
  resolutionCount: number
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
    const withMtime = await Promise.all(
      jsonlFiles.map(async f => ({
        name: f,
        path: join(projectDir, f),
        mtime: (await stat(join(projectDir, f))).mtime.getTime(),
      }))
    )
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
  const stateFile = join(getAgentDir(agentId), 'state.json')
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(await readFile(stateFile, 'utf-8'))
      if (state.workspace) return state.workspace
    } catch {}
  }
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
}async function getPendingQuestionsPromise(jsonlPath: string): Promise<PendingQuestion[]> {
  if (!existsSync(jsonlPath)) return []
  try {
    // Only read the last 512KB — pending questions are always recent.
    const content = await readFileTail(jsonlPath, 512_000)
    const lines = content.split('\n').filter(line => line.trim())
    const toolCalls = new Map<string, PendingQuestion>()
    const answeredIds = new Set<string>()
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        const messageContent = entry.message?.content
        if (!Array.isArray(messageContent)) continue
        for (const item of messageContent) {
          if (item.type === 'tool_use' && item.name === 'AskUserQuestion') {
            toolCalls.set(item.id, {
              toolId: item.id,
              timestamp: entry.timestamp || new Date().toISOString(),
              questions: item.input?.questions || [],
            })
          }
          if (item.type === 'tool_result' && item.tool_use_id) {
            answeredIds.add(item.tool_use_id)
          }
        }
      } catch {}
    }
    return Array.from(toolCalls.entries())
      .filter(([id]) => !answeredIds.has(id))
      .map(([, question]) => question)
  } catch {
    return []
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

  // Read state.json role for enrichment projection.
  const stateFile = join(getAgentDir(agentId), 'state.json')
  let stateRole: string | undefined
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(await readFile(stateFile, 'utf-8'))
      stateRole = state.role
    } catch {}
  }

  const role: AgentEnrichment['role'] =
    (stateRole === 'plan' || stateRole === 'work' || stateRole === 'review' ||
     stateRole === 'test' || stateRole === 'ship' || stateRole === 'flywheel')
      ? stateRole
      : (isPlanning ? 'plan' : undefined)

  // Get runtime state for resolution + explicit waiting signals.
  const runtimeState = await Effect.runPromise(getAgentRuntimeState(agentId))

  // Get pending questions, filtered by agent start time.
  // Skip JSONL scan when mtime is unchanged (optimization for static TUI sessions).
  let pendingQuestions: PendingQuestion[] = []
  if (!skipJsonlScan) {
    pendingQuestions = [...await Effect.runPromise(getAgentPendingQuestions(agentId))]
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
  const hasPendingQuestion = !hasActiveSpecialist && detection !== null

  return {
    role,
    hasPendingQuestion,
    pendingQuestionCount: pendingQuestions.length,
    pendingQuestionPrompt: detection?.prompt,
    pendingQuestionReason: detection?.reason,
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
