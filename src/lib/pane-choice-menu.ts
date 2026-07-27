/**
 * PAN-3113 — parse blocking numbered-choice menus from a captured tmux pane.
 *
 * Claude Code (and sibling harnesses) render modal choices as a cursor-driven
 * numbered menu — the session-resume gate is the driving case:
 *
 *   This session is 4h 5m old and 146.9k tokens.
 *
 *   Resuming the full session will consume a substantial portion of your
 *   usage limits. We recommend resuming from a summary.
 *
 *   ❯ 1. Resume from summary (recommended)
 *     2. Resume full session as-is
 *     3. Don't ask me again
 *
 *   Enter to confirm · Esc to cancel
 *
 * These menus never appear as transcript tool calls, so neither the AUQ
 * pipeline nor the JSONL pending-input scan can see them. This module turns
 * the pane text into a structured menu the dashboard can render as an
 * actionable card (PAN-3113 mockup A) and answer with literal keystrokes
 * (Down × N + Enter).
 *
 * The parser is deliberately conservative — a false positive parks a phantom
 * decision card in a live conversation, which is worse than a miss:
 *
 *  - Options must be numbered sequentially from 1 (kills prose lists such as
 *    "3. FCM push is dead…" and "1. First step / 2. Second step" plans).
 *  - High confidence requires BOTH a ❯ cursor row and a harness footer hint
 *    ("Enter to confirm · Esc to cancel"). Exactly one of the two is low
 *    confidence (render the verbatim mirror, not the card). Neither → null.
 *  - The menu must be the current bottom-of-pane surface: after the menu and
 *    its footer, only blank lines, box separators, or further footer hints
 *    may follow. Real output below the menu means it was answered/scrolled.
 *  - Claude permission menus ("1. Yes / 2. Yes, and allow / 3. No") are
 *    excluded — the existing tool_permission detection path owns them.
 *  - Multi-select menus ("space to select") are excluded — answering needs
 *    toggle semantics the card does not model.
 */

const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

const CURSOR_CHARS = ['❯', '›']

/** "❯ 1. Resume from summary (recommended)" / "  2. Resume full session as-is" */
const OPTION_LINE = /^\s*(❯|›)?\s*(\d{1,2})[.)]\s+(\S.*)$/

/** Box-drawing separator lines (Claude draws ─── rules around its input box). */
const SEPARATOR_LINE = /^\s*[─━═]{6,}\s*$/

/** Bare input prompt with nothing typed — the menu is gone when this follows. */
const BARE_PROMPT_LINE = /^\s*(❯|›)\s*$/

const MAX_TRAILING_LINES = 6
const MAX_CONTEXT_LINES = 8
const MAX_OPTIONS = 9
const MAX_LABEL_CHARS = 100
const RECOMMENDED_SUFFIX = /\s*\((recommended)\)\s*$/i

export interface PaneChoiceMenuOption {
  /** Number as rendered in the pane (1-based). */
  number: number
  /** Option text with any "(recommended)" suffix stripped. */
  label: string
  recommended: boolean
}

export type PaneChoiceConfidence = 'high' | 'low'

export interface PaneChoiceMenu {
  /** First context line above the options — the menu's headline. */
  title: string
  /** Non-blank context lines above the options, top-down order. */
  contextLines: string[]
  options: PaneChoiceMenuOption[]
  /** Index into options[] of the row holding the ❯ cursor (0 when unknown). */
  selectedIndex: number
  /** e.g. "Enter to confirm · Esc to cancel", when present. */
  footerHint: string | null
  confidence: PaneChoiceConfidence
}

function cleanLine(line: string): string {
  return line
    .replace(ANSI_PATTERN, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+$/g, '')
}

/**
 * PAN-3068 shape — key/action pairs separated by "·". Every segment must open
 * with a key name, so real post-answer output never qualifies.
 */
function looksLikeHarnessFooterHint(line: string): boolean {
  const segments = line.split('·').map((s) => s.trim()).filter(Boolean)
  if (segments.length === 0) return false
  return segments.every(
    (segment) =>
      /^(?:esc(?:ape)?|tab|enter|return|space|backspace|shift\+\S+|ctrl\+\S+|alt\+\S+|\?)\b/i.test(segment)
      || /^press\s+\S+/i.test(segment),
  )
}

/** "1. Yes / 2. Yes, and allow… / 3. No" — owned by the permission-menu path. */
function looksLikePermissionOptions(options: PaneChoiceMenuOption[]): boolean {
  if (options.length !== 3) return false
  return (
    /^yes$/i.test(options[0]!.label)
    && /^yes,?\s*(?:and\s*)?(?:allow|don't ask|always)/i.test(options[1]!.label)
    && /^no\b/i.test(options[2]!.label)
  )
}

interface ParsedOptionLine {
  cursor: boolean
  number: number
  rawLabel: string
}

function parseOptionLine(line: string): ParsedOptionLine | null {
  const match = OPTION_LINE.exec(line)
  if (!match) return null
  const number = Number(match[2])
  if (!Number.isInteger(number) || number < 1 || number > MAX_OPTIONS) return null
  const rawLabel = match[3]!.trim()
  if (rawLabel.length === 0 || rawLabel.length > MAX_LABEL_CHARS) return null
  return { cursor: Boolean(match[1]), number, rawLabel }
}

/**
 * Parse the last numbered-choice menu in the pane, or null when the pane is
 * not currently blocked on one. See the module header for the conservative
 * acceptance rules.
 *
 * `mode: 'guard'` keeps the menus card rendering excludes — permission prompts
 * and multi-selects. A caller that only wants to know "is this pane blocked on
 * a menu?" must see those too; see `paneHasBlockingChoiceMenu`.
 */
export function parsePaneChoiceMenu(
  paneText: string,
  opts: { mode?: 'card' | 'guard' } = {},
): PaneChoiceMenu | null {
  const mode = opts.mode ?? 'card'
  if (!paneText) return null
  const lines = paneText.split('\n').map(cleanLine)

  // tmux pads the capture with blank filler to the pane's full height — anchor
  // all scanning at the last non-blank line, not the physical end.
  let end = lines.length - 1
  while (end >= 0 && lines[end]!.trim() === '') end -= 1
  if (end < 0) return null

  // Find the last line that parses as a numbered option — the candidate
  // menu's final row — then walk upward collecting the contiguous option run.
  let lastOption = -1
  for (let i = end; i >= 0; i -= 1) {
    if (parseOptionLine(lines[i]!)) { lastOption = i; break }
    // Don't scan the whole scrollback: menus are current-surface UI, so only
    // look back through what trailing chrome we would accept anyway.
    if (end - i > MAX_TRAILING_LINES + MAX_OPTIONS) break
  }
  if (lastOption < 0) return null

  const optionLines: ParsedOptionLine[] = []
  let firstOption = lastOption
  for (let i = lastOption; i >= 0; i -= 1) {
    const parsed = parseOptionLine(lines[i]!)
    if (!parsed) break
    optionLines.unshift(parsed)
    firstOption = i
  }
  if (optionLines.length < 2 || optionLines.length > MAX_OPTIONS) return null

  // Numbers must be sequential from 1 — a prose list ("3. FCM push is dead…")
  // or a plan outline never satisfies this.
  for (let i = 0; i < optionLines.length; i += 1) {
    if (optionLines[i]!.number !== i + 1) return null
  }

  const cursorRows = optionLines
    .map((opt, index) => (opt.cursor ? index : -1))
    .filter((index) => index >= 0)
  if (cursorRows.length > 1) return null

  // Trailing rule: after the option block, only blank lines, box separators,
  // or harness footer hints may follow (bounded). A bare ❯ prompt or real
  // output below means the menu was answered or scrolled away.
  const trailing = lines.slice(lastOption + 1).filter((line) => line.trim() !== '')
  if (trailing.length > MAX_TRAILING_LINES) return null
  let footerHint: string | null = null
  for (const line of trailing) {
    if (BARE_PROMPT_LINE.test(line)) return null
    if (SEPARATOR_LINE.test(line)) continue
    if (looksLikeHarnessFooterHint(line.trim())) {
      if (footerHint === null) footerHint = line.trim()
      continue
    }
    return null
  }

  const options: PaneChoiceMenuOption[] = optionLines.map((opt) => {
    const recommended = RECOMMENDED_SUFFIX.test(opt.rawLabel)
    return {
      number: opt.number,
      label: recommended ? opt.rawLabel.replace(RECOMMENDED_SUFFIX, '') : opt.rawLabel,
      recommended,
    }
  })

  // Exclusions — menus another pipeline owns, or shapes the card cannot model.
  // Guard mode keeps them: they still block the pane, so a caller about to
  // press Enter blind must be told they are there.
  if (mode === 'card') {
    if (looksLikePermissionOptions(options)) return null
    if (footerHint && /space\s+to\s+(?:select|toggle)/i.test(footerHint)) return null
  }

  // Context block: lines above the first option, skipping the blank gap, then
  // collecting upward. Menus keep their context tight (headline + one
  // explanation paragraph), so cap at two blank-separated paragraphs — a third
  // paragraph upward is scrollback from the previous turn, not menu context.
  // `paragraphs` counts completed paragraphs (incremented on each paragraph's
  // top line, i.e. the non-blank line whose downward neighbour is blank).
  const contextLines: string[] = []
  let paragraphs = 0
  let i = firstOption - 1
  while (i >= 0 && lines[i]!.trim() === '') i -= 1
  for (; i >= 0 && contextLines.length < MAX_CONTEXT_LINES; i -= 1) {
    const line = lines[i]!
    if (SEPARATOR_LINE.test(line) || BARE_PROMPT_LINE.test(line)) break
    if (parseOptionLine(line)) break
    if (line.trim() === '') {
      // Blank run: crossing into a third paragraph means we have left the
      // menu's own context — stop before it.
      if (paragraphs >= 2) break
      let j = i - 1
      while (j >= 0 && lines[j]!.trim() === '') j -= 1
      if (j < 0 || SEPARATOR_LINE.test(lines[j]!) || BARE_PROMPT_LINE.test(lines[j]!) || parseOptionLine(lines[j])) break
      i = j + 1
      continue
    }
    if (lines[i + 1] === undefined || lines[i + 1]!.trim() === '') paragraphs += 1
    contextLines.unshift(line.trim())
  }

  const hasCursor = cursorRows.length === 1
  if (!hasCursor && footerHint === null) return null
  const confidence: PaneChoiceConfidence = hasCursor && footerHint !== null ? 'high' : 'low'

  return {
    title: contextLines[0] ?? options[0]!.label,
    contextLines,
    options,
    selectedIndex: hasCursor ? cursorRows[0]! : 0,
    footerHint,
    confidence,
  }
}

/**
 * True when the pane is blocked on ANY numbered menu, including the permission
 * and multi-select shapes card rendering skips.
 *
 * Callers that would otherwise press Enter with nothing verified in the
 * composer MUST consult this first: a bare Enter confirms the menu's
 * highlighted row, which answers a question nobody asked. The session-resume
 * gate defaults to "Resume from summary", so a stray Enter there discards the
 * operator's full session (PAN-3212).
 */
export function paneHasBlockingChoiceMenu(paneText: string): boolean {
  return parsePaneChoiceMenu(paneText, { mode: 'guard' }) !== null
}

/** Stable identity for patrol dedupe — same menu re-parsed must not re-surface. */
export function paneChoiceMenuSignature(menu: PaneChoiceMenu): string {
  return `${menu.title}::${menu.options.map((o) => `${o.number}:${o.label}`).join('|')}`
}

/**
 * Literal tmux keystrokes answering the menu with `selectedIndex`: arrow the
 * cursor from its current row to the target, then confirm. Claude Code menus
 * move the ❯ cursor with ↑/↓ and confirm with Enter; number keys are not
 * guaranteed across harness versions, so arrows are the universal path.
 */
export function buildChoiceKeystrokes(menu: PaneChoiceMenu, selectedIndex: number): string[] {
  const clamped = Math.max(0, Math.min(selectedIndex, menu.options.length - 1))
  const from = menu.selectedIndex
  const keys: string[] = []
  for (let i = from; i < clamped; i += 1) keys.push('Down')
  for (let i = from; i > clamped; i -= 1) keys.push('Up')
  keys.push('Enter')
  return keys
}
