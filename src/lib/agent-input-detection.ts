import { Effect } from 'effect'
import { capturePaneAsyncEffect } from './tmux.js'
import { TmuxError } from './errors.js'

export type AwaitingInputReason = 'tool_permission' | 'user_question' | 'disambiguation' | 'confirmation' | 'planning_done' | 'other'

export interface AwaitingInputDetection {
  reason: AwaitingInputReason
  prompt: string
}

const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const MAX_PROMPT_CHARS = 2_000
const PANE_DETECTION_CACHE_TTL_MS = 10_000
const MAX_PANE_DETECTION_CACHE_ENTRIES = 256
const MAX_CONCURRENT_PANE_DETECTIONS = 4

type PaneDetectionCacheEntry = {
  expiresAt: number
  detection: AwaitingInputDetection | null
}

const paneDetectionCache = new Map<string, PaneDetectionCacheEntry>()
const paneDetectionInFlight = new Map<string, Promise<AwaitingInputDetection | null>>()
const paneDetectionWaiters: Array<() => void> = []
let activePaneDetections = 0

function getPaneDetectionCacheKey(agentId: string, options: { isPlanning?: boolean; lines?: number }): string {
  return `${agentId}:${options.isPlanning === true ? 'planning' : 'agent'}:${options.lines ?? 90}`
}

function sweepPaneDetectionCache(now = Date.now()): void {
  for (const [key, entry] of paneDetectionCache) {
    if (entry.expiresAt <= now) {
      paneDetectionCache.delete(key)
    }
  }

  while (paneDetectionCache.size > MAX_PANE_DETECTION_CACHE_ENTRIES) {
    const oldestKey = paneDetectionCache.keys().next().value
    if (!oldestKey) break
    paneDetectionCache.delete(oldestKey)
  }
}

async function withPaneDetectionSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activePaneDetections >= MAX_CONCURRENT_PANE_DETECTIONS) {
    await new Promise<void>((resolve) => paneDetectionWaiters.push(resolve))
  }
  activePaneDetections += 1
  try {
    return await fn()
  } finally {
    activePaneDetections = Math.max(0, activePaneDetections - 1)
    paneDetectionWaiters.shift()?.()
  }
}

function cleanPaneLine(line: string): string {
  return line
    .replace(ANSI_PATTERN, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+$/g, '')
}

function compactPrompt(prompt: string): string {
  const compact = prompt
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim()

  if (compact.length <= MAX_PROMPT_CHARS) return compact
  return `${compact.slice(0, MAX_PROMPT_CHARS - 1)}…`
}

export function normalizeAwaitingInputPrompt(prompt: string): string {
  return compactPrompt(prompt)
}

function snippetAround(lines: string[], index: number, before = 8, after = 4): string {
  const start = Math.max(0, index - before)
  const end = Math.min(lines.length, index + after + 1)
  return compactPrompt(lines.slice(start, end).join('\n'))
}

function lastIndexMatching(lines: string[], predicate: (line: string, index: number) => boolean): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (predicate(lines[i]!, i)) return i
  }
  return -1
}

function isRecentPromptIndex(lines: string[], index: number): boolean {
  if (index < 0) return false
  return lines.length - index <= 25
}

function isCurrentPromptIndex(lines: string[], index: number, maxTrailingLines = 0): boolean {
  if (index < 0) return false
  return lines.length - index <= maxTrailingLines + 1
}

function findPermissionMenuEndIndex(lines: string[], menuStartIndex: number): number {
  if (menuStartIndex < 0) return -1
  const end = Math.min(lines.length, menuStartIndex + 8)
  for (let i = menuStartIndex; i < end; i += 1) {
    if (/\s*3\.\s*No\b/i.test(lines[i]!)) return i
  }
  return menuStartIndex
}

function looksLikeClaudePermissionMenu(text: string): boolean {
  return /(?:^|\n)\s*❯?\s*1\.\s*Yes\b/i.test(text)
    && /(?:^|\n)\s*2\.\s*Yes,?\s*(?:and\s*)?(?:allow|don't ask|always)/i.test(text)
    && /(?:^|\n)\s*3\.\s*No\b/i.test(text)
}

function looksLikePermissionText(text: string): boolean {
  return /permission|allow(?:\s+this)?|tool use|bash command|mcp tool|do you want to proceed|do you want to continue/i.test(text)
}

function looksLikeGenericConfirmation(line: string): boolean {
  return /(?:\?|:)\s*(?:\[[Yy]\/[Nn]\]|\[[Nn]\/[Yy]\]|\([Yy]\/[Nn]\)|\([Nn]\/[Yy]\)|\[y\/N\]|\[Y\/n\])\s*$/i.test(line)
    || /\b(?:continue|proceed|confirm|approve|allow|run|execute|overwrite|delete|remove)\b.*(?:\[[Yy]\/[Nn]\]|\([Yy]\/[Nn]\)|\[y\/N\]|\[Y\/n\])/i.test(line)
}

function looksLikePiPermission(text: string): boolean {
  return /(?:permission|approval|approve|allow).{0,80}(?:required|request|prompt|action|command)/i.test(text)
    || /(?:allow|approve|run|execute)\s+(?:this\s+)?(?:command|tool|action)/i.test(text)
}

function looksLikePlanningDone(text: string): boolean {
  return /planning finalized\s*[—-]\s*click done/i.test(text)
    || /click Done in the dashboard/i.test(text)
    || /planning (?:is )?complete.{0,120}(?:click|press|select) Done/i.test(text)
}

export function detectAwaitingInputFromPane(
  pane: string,
  options: { isPlanning?: boolean } = {},
): AwaitingInputDetection | null {
  const lines = pane
    .split('\n')
    .map(cleanPaneLine)
    .filter((line) => line.trim().length > 0)
  if (lines.length === 0) return null

  const recentLines = lines.slice(-45)
  const recentText = recentLines.join('\n')

  if (looksLikeClaudePermissionMenu(recentText) && looksLikePermissionText(recentText)) {
    const menuIndex = lastIndexMatching(lines, (line) => /❯?\s*1\.\s*Yes\b/i.test(line))
    const menuEndIndex = findPermissionMenuEndIndex(lines, menuIndex)
    if (isRecentPromptIndex(lines, menuIndex) && isCurrentPromptIndex(lines, menuEndIndex)) {
      return {
        reason: 'tool_permission',
        prompt: snippetAround(lines, menuIndex, 10, 3),
      }
    }
  }

  const piIndex = lastIndexMatching(lines, (line) => looksLikePiPermission(line) || looksLikeGenericConfirmation(line))
  if (isRecentPromptIndex(lines, piIndex) && isCurrentPromptIndex(lines, piIndex)) {
    const snippet = snippetAround(lines, piIndex, 6, 2)
    const reason = looksLikeGenericConfirmation(lines[piIndex]!) ? 'confirmation' : 'tool_permission'
    return { reason, prompt: snippet }
  }

  if (options.isPlanning && looksLikePlanningDone(recentText)) {
    const doneIndex = lastIndexMatching(lines, (line) => /done|planning/i.test(line))
    return {
      reason: 'planning_done',
      prompt: snippetAround(lines, doneIndex >= 0 ? doneIndex : lines.length - 1, 8, 2),
    }
  }

  return null
}

export async function detectAwaitingInputForAgent(
  agentId: string,
  options: { isPlanning?: boolean; lines?: number; cache?: boolean } = {},
): Promise<AwaitingInputDetection | null> {
  const cacheEnabled = options.cache !== false
  const cacheKey = getPaneDetectionCacheKey(agentId, options)
  const now = Date.now()

  if (cacheEnabled) {
    sweepPaneDetectionCache(now)

    const cached = paneDetectionCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      paneDetectionCache.delete(cacheKey)
      paneDetectionCache.set(cacheKey, cached)
      return cached.detection
    }

    const inFlight = paneDetectionInFlight.get(cacheKey)
    if (inFlight) return inFlight
  }

  const detectionPromise = withPaneDetectionSlot(async () => {
    const pane = await Effect.runPromise(capturePaneAsyncEffect(agentId, options.lines ?? 90))
    const detection = detectAwaitingInputFromPane(pane, options)
    if (cacheEnabled) {
      paneDetectionCache.set(cacheKey, {
        expiresAt: Date.now() + PANE_DETECTION_CACHE_TTL_MS,
        detection,
      })
      sweepPaneDetectionCache()
    }
    return detection
  })

  if (!cacheEnabled) return detectionPromise

  paneDetectionInFlight.set(cacheKey, detectionPromise)
  try {
    return await detectionPromise
  } finally {
    paneDetectionInFlight.delete(cacheKey)
  }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect-native variant of detectAwaitingInputForAgent. Fails with TmuxError if
 * the pane capture fails outside the in-cache fast path.
 */
export const detectAwaitingInputForAgentEffect = (
  agentId: string,
  options: { isPlanning?: boolean; lines?: number; cache?: boolean } = {},
): Effect.Effect<AwaitingInputDetection | null, TmuxError> =>
  Effect.tryPromise({
    try: () => detectAwaitingInputForAgent(agentId, options),
    catch: (cause) =>
      new TmuxError({
        command: 'capture-pane',
        message: `failed to detect awaiting input for ${agentId}`,
        cause,
      }),
  })

/**
 * Capture the pane and return the detection synchronously. This is a pure
 * function over a captured string — exported for symmetry, useful when the
 * caller already has the pane text in hand.
 */
export const detectAwaitingInputFromPaneEffect = (
  pane: string,
  options: { isPlanning?: boolean } = {},
): Effect.Effect<AwaitingInputDetection | null> =>
  Effect.sync(() => detectAwaitingInputFromPane(pane, options))
