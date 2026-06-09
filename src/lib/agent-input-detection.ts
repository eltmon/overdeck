import { Effect } from 'effect'
import { capturePane } from './tmux.js'
import { TmuxError } from './errors.js'

export type AwaitingInputReason = 'tool_permission' | 'user_question' | 'disambiguation' | 'confirmation' | 'planning_done' | 'session_resume' | 'other'

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

/**
 * PAN-1520 (covers #1197) — Claude Code session-resume dialog. Fires when an
 * agent is resumed via `claude --resume <session>` and a prior session is
 * still considered active or interrupted. The dialog blocks tool execution
 * until acknowledged. Conservative patterns — we want false-negatives over
 * false-positives, so we only match strings that clearly indicate a resume
 * choice point.
 */
function looksLikeSessionResumeDialog(text: string): boolean {
  return /this session (?:is|was)\s+(?:still\s+)?(?:active|interrupted|running)/i.test(text)
    || /resume (?:the\s+)?previous session/i.test(text)
    || /(?:continue|resume) (?:this\s+)?session\??.{0,40}(?:\[[Yy]\/[Nn]\]|\([Yy]\/[Nn]\)|press\s+enter)/i.test(text)
    || /press enter to (?:continue|resume)/i.test(text)
}

/**
 * PAN-1690 — Codex TUI approval prompt header. Codex asks for approval with a
 * distinctive "Would you like to …?" prompt box (command run, edits, network/
 * host grants) followed by a numbered Yes/…/No menu. Unlike Claude's menu,
 * Codex renders option descriptions and a footer hint *below* "3. No", so the
 * trailing-line heuristics the Claude path relies on never fire — we key on the
 * header instead. Verb list pulled from the codex binary; see PAN-1690.
 */
function looksLikeCodexApprovalHeader(line: string): boolean {
  return /Would you like to (?:run the following command|grant these permissions?|make the following edits|allow|apply)\b/i.test(line)
}

export function detectAwaitingInputFromPaneSync(
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

  // PAN-1690 — Codex TUI approval prompt. Key on the distinctive header plus a
  // still-visible numbered option list near the bottom (so an answered prompt
  // that scrolled into history doesn't re-fire). Tolerates the option
  // descriptions / footer hint Codex renders below "3. No".
  const codexHeaderIndex = lastIndexMatching(lines, looksLikeCodexApprovalHeader)
  if (codexHeaderIndex >= 0 && isRecentPromptIndex(lines, codexHeaderIndex)) {
    // Tolerate whatever selection-cursor glyph Codex renders (❯ › > ▶ •) — or
    // none — by consuming any leading non-word characters before "1. Yes".
    const optionIndex = lastIndexMatching(lines, (line) => /^[^\w]*1\.\s*Yes\b/i.test(line))
    if (optionIndex > codexHeaderIndex && lines.length - optionIndex <= 12) {
      return {
        reason: 'tool_permission',
        prompt: snippetAround(lines, codexHeaderIndex, 1, 14),
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

  // PAN-1520 (covers #1197) — Claude Code session-resume dialog.
  if (looksLikeSessionResumeDialog(recentText)) {
    const resumeIndex = lastIndexMatching(lines, (line) => looksLikeSessionResumeDialog(line))
    return {
      reason: 'session_resume',
      prompt: snippetAround(lines, resumeIndex >= 0 ? resumeIndex : lines.length - 1, 8, 2),
    }
  }

  return null
}async function detectAwaitingInputForAgentPromise(
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
    const pane = await Effect.runPromise(capturePane(agentId, options.lines ?? 90))
    const detection = detectAwaitingInputFromPaneSync(pane, options)
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
export const detectAwaitingInputForAgent = (
  agentId: string,
  options: { isPlanning?: boolean; lines?: number; cache?: boolean } = {},
): Effect.Effect<AwaitingInputDetection | null, TmuxError> =>
  Effect.tryPromise({
    try: () => detectAwaitingInputForAgentPromise(agentId, options),
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
export const detectAwaitingInputFromPane = (
  pane: string,
  options: { isPlanning?: boolean } = {},
): Effect.Effect<AwaitingInputDetection | null> =>
  Effect.sync(() => detectAwaitingInputFromPaneSync(pane, options))

export interface CodexApprovalPrompt {
  /** The "Would you like to …?" header line. */
  header: string
  /** Lines between the header and the first option (command, reason, etc.). */
  detail: string
  /** The numbered menu options, in order. */
  options: Array<{ number: number; label: string }>
}

/**
 * PAN-1690 — parse a Codex approval prompt (as captured by the codex-aware
 * branch of detectAwaitingInputFromPaneSync) into its header, detail, and
 * numbered options, so the dashboard can render the menu and answer it without
 * the terminal. Returns null when the text doesn't contain a usable menu
 * (fewer than two numbered options). Option lines tolerate a leading selection
 * cursor (❯ › > etc.); the footer hint and other non-numbered lines are
 * naturally excluded.
 */
export function parseCodexApprovalPrompt(text: string): CodexApprovalPrompt | null {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) return null

  const headerIndex = lines.findIndex((l) => looksLikeCodexApprovalHeader(l))
  if (headerIndex < 0) return null

  const optionRe = /^[^\w]*(\d+)\.\s*(.+?)\s*$/
  const options: Array<{ number: number; label: string }> = []
  const detailLines: string[] = []
  let firstOptionSeen = false
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const m = optionRe.exec(lines[i]!)
    if (m) {
      firstOptionSeen = true
      options.push({ number: Number(m[1]), label: m[2]!.trim() })
    } else if (!firstOptionSeen) {
      detailLines.push(lines[i]!)
    }
    // Lines after the first option that aren't options (footer hints, blanks)
    // are ignored.
  }

  if (options.length < 2) return null
  return {
    header: lines[headerIndex]!,
    detail: detailLines.join('\n'),
    options,
  }
}
