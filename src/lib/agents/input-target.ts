/**
 * PAN-4268: where Claude Code sends typed input, read from its agent selector.
 *
 * Claude Code draws an agent selector at the very bottom of its pane, below
 * the prompt box, whenever the session has listed subagents:
 *
 *     ● main
 *     ◯ general-purpose  Counter run      1m 13s · ↓ 23.8k tokens
 *
 * The filled dot (`●`, `⏺` on macOS) marks the agent that receives typed
 * input. A running subagent is neither necessary nor sufficient for input to
 * go to it — only the filled dot decides. This module parses that selector
 * from a plain-text pane screen; fixtures captured from Claude Code 2.1.280
 * live in `__fixtures__/claude-code-2.1.280/`, so a UI change breaks a test
 * instead of misrouting silently.
 */

export interface SelectorRow {
  readonly cursor: boolean;        // line starts with '❯ '
  readonly filled: boolean;        // glyph is ● or ⏺
  readonly label: string;          // text after the glyph, trimmed
  readonly agentType: string;      // 'main' | first ≥2-space segment without ' (+N)'
  readonly groupCount: number;     // N from ' (+N)', else 0
  readonly description: string;    // second ≥2-space segment, else agentType
}

export interface SelectorState {
  readonly rows: readonly SelectorRow[];
  readonly filledIndex: number | null;   // null when zero or several rows are filled
  readonly filledCount: number;
  readonly cursorIndex: number | null;
  readonly mainIndex: number | null;
  readonly promptText: string;           // '' when empty or the subagent placeholder
  readonly footerHint: boolean;          // '↑/↓ to select' or 'Enter to view' line present
  readonly fleetView: boolean;           // a line after the bottom rule contains 'enter to return'
}

export type InputTarget = 'main' | { readonly subagent: string } | 'unknown';

const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const BOTTOM_RULE = /^─+$/;
const TOP_RULE = /^─/;
const SELECTOR_ROW = /^(❯ | {2})([●◯⏺]) (.+)$/;
const GROUP_SUFFIX = / \(\+(\d+)\)$/;
const SUBAGENT_PLACEHOLDER = /^Message @\S+…$/;

const EMPTY_STATE: SelectorState = {
  rows: [],
  filledIndex: null,
  filledCount: 0,
  cursorIndex: null,
  mainIndex: null,
  promptText: '',
  footerHint: false,
  fleetView: false,
};

function parseRow(match: RegExpExecArray): SelectorRow {
  const label = match[3].trim();
  const segments = label.split(/\s{2,}/);
  const head = segments[0];
  const group = GROUP_SUFFIX.exec(head);
  const agentType = group ? head.slice(0, group.index) : head;
  return {
    cursor: match[1] === '❯ ',
    filled: match[2] !== '◯',
    label,
    agentType,
    groupCount: group ? Number(group[1]) : 0,
    description: segments[1] ?? agentType,
  };
}

function readPromptText(lines: readonly string[], topIndex: number, bottomIndex: number): string {
  const body = lines.slice(topIndex + 1, bottomIndex).map((line, index) =>
    index === 0 ? line.replace(/^❯ ?/, '') : line.trim(),
  );
  const text = body.join('\n').trim();
  return SUBAGENT_PLACEHOLDER.test(text) ? '' : text;
}

/** Parse Claude Code's agent selector from a plain-text pane screen. */
export function parseAgentSelector(screen: string): SelectorState {
  const lines = screen.split('\n').map((line) => line.replace(ANSI_PATTERN, '').trimEnd());

  let bottomIndex = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (BOTTOM_RULE.test(lines[i])) {
      bottomIndex = i;
      break;
    }
  }
  if (bottomIndex === -1) return EMPTY_STATE;

  let topIndex = -1;
  for (let i = bottomIndex - 1; i >= 0; i -= 1) {
    if (TOP_RULE.test(lines[i])) {
      topIndex = i;
      break;
    }
  }
  const promptText = topIndex === -1 ? '' : readPromptText(lines, topIndex, bottomIndex);

  const rows: SelectorRow[] = [];
  let footerHint = false;
  let fleetView = false;
  for (const line of lines.slice(bottomIndex + 1)) {
    const match = SELECTOR_ROW.exec(line);
    if (match) {
      rows.push(parseRow(match));
      continue;
    }
    const content = line.trim();
    if (content.includes('to select · Enter to view') || content.startsWith('Enter to view')) footerHint = true;
    if (content.includes('enter to return')) fleetView = true;
  }

  const filled = rows.flatMap((row, index) => (row.filled ? [index] : []));
  const cursorIndex = rows.findIndex((row) => row.cursor);
  const mainIndex = rows.findIndex((row) => row.agentType === 'main');
  return {
    rows,
    filledIndex: filled.length === 1 ? filled[0] : null,
    filledCount: filled.length,
    cursorIndex: cursorIndex === -1 ? null : cursorIndex,
    mainIndex: mainIndex === -1 ? null : mainIndex,
    promptText,
    footerHint,
    fleetView,
  };
}

/** Where typed input goes, derived from a parsed selector. */
export function inputTargetFromSelector(state: SelectorState): InputTarget {
  if (state.fleetView) return 'unknown';
  if (state.rows.length === 0) return 'main';
  if (state.mainIndex === null || state.filledCount !== 1 || state.filledIndex === null) return 'unknown';
  if (state.filledIndex === state.mainIndex) return 'main';
  return { subagent: state.rows[state.filledIndex].description };
}
