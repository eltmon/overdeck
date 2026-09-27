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
 *
 * `ensureMainInputTarget` is the closed loop the composer route and
 * `messageAgent` run before pasting: it reads the pane, moves the filled dot
 * back to `main` with `Down`/`Up`/`Enter`/`Escape` only, re-reads after every
 * key, and refuses when the final read does not show input going to main.
 */

import { resolveAgentPaneIo, type AgentPaneIo, type SelectorKey } from '../terminal-backends/agent-pane-io.js';

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

/** Poll interval while waiting for the pane to reflect a key. */
export const SELECTOR_POLL_MS = 150;
/** How long one key may take to show on the pane before the step fails. */
export const SELECTOR_SETTLE_TIMEOUT_MS = 1500;
/** `Down` presses allowed to move focus from the prompt into the selector. */
const MAX_FOOTER_ENTRY_PRESSES = 4;
const PANE_READ_LINES = 60;

export interface EnsureMainDeps {
  /** Resolved once per call. Default: `resolveAgentPaneIo`. */
  readonly io: (agentId: string) => Promise<Pick<AgentPaneIo, 'read' | 'sendKey'>>;
  readonly sleep: (ms: number) => Promise<void>;
}

export type EnsureMainResult =
  | { readonly ok: true; readonly check: 'no-selector' | 'already-main' | 'switched'; readonly switchedFromSubagent?: string }
  | { readonly ok: false; readonly reason: string; readonly inputTarget: InputTarget };

class EnsureMainRefusal extends Error {}

function refuse(reason: string): never {
  throw new EnsureMainRefusal(reason);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const UNRECOGNIZED_REASON =
  "Claude Code's agent selector is on screen but its layout was not recognized (fixtures cover Claude Code 2.1.280), so the message was not sent.";

/**
 * Make Claude Code send typed input to the main agent before a message is
 * pasted (PAN-4268). Sends only `Down`, `Up`, `Enter` and `Escape`, re-reads
 * the pane after every key, and succeeds only when a final read shows `●` on
 * `main` with no footer cursor. Every refusal sends no message.
 */
export async function ensureMainInputTarget(agentId: string, deps: Partial<EnsureMainDeps> = {}): Promise<EnsureMainResult> {
  const resolveIo = deps.io ?? resolveAgentPaneIo;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let state: SelectorState = EMPTY_STATE;
  let readFailed = false;

  try {
    let pane: Pick<AgentPaneIo, 'read' | 'sendKey'>;
    try {
      pane = await resolveIo(agentId);
    } catch (error) {
      readFailed = true;
      return refuse(`Could not read ${agentId}'s pane to check which agent Claude Code sends typed input to: ${errorText(error)}`);
    }

    const read = async (): Promise<SelectorState> => {
      let text: string;
      try {
        text = await pane.read(PANE_READ_LINES);
      } catch (error) {
        readFailed = true;
        return refuse(`Could not read ${agentId}'s pane to check which agent Claude Code sends typed input to: ${errorText(error)}`);
      }
      state = parseAgentSelector(text);
      return state;
    };
    const press = async (key: SelectorKey): Promise<void> => {
      try {
        await pane.sendKey(key);
      } catch (error) {
        refuse(`Could not send a navigation key to ${agentId}: ${errorText(error)}`);
      }
    };
    const settle = async (done: (current: SelectorState) => boolean): Promise<boolean> => {
      for (let i = 0; i < SELECTOR_SETTLE_TIMEOUT_MS / SELECTOR_POLL_MS; i += 1) {
        await sleep(SELECTOR_POLL_MS);
        if (done(await read())) return true;
      }
      return done(state);
    };
    const mainFilled = (current: SelectorState): boolean =>
      current.mainIndex !== null && current.filledIndex === current.mainIndex;

    await read();

    if (state.fleetView) {
      await press('Escape');
      if (!(await settle((current) => !current.fleetView))) {
        refuse('Claude Code is showing its agents overview instead of this session, so the message was not sent.');
      }
    }

    if (state.rows.length === 0) return { ok: true, check: 'no-selector' };
    if (inputTargetFromSelector(state) === 'unknown') refuse(UNRECOGNIZED_REASON);
    if (mainFilled(state) && state.cursorIndex === null) return { ok: true, check: 'already-main' };

    const from = mainFilled(state) ? undefined : state.rows[state.filledIndex as number].description;

    if (state.cursorIndex === null) {
      if (state.promptText !== '') {
        refuse("The pane's prompt holds unsent text, so Overdeck cannot move Claude Code's input back to the main agent without disturbing it.");
      }
      let focused = false;
      for (let presses = 0; presses < MAX_FOOTER_ENTRY_PRESSES && !focused; presses += 1) {
        await press('Down');
        focused = await settle((current) => current.cursorIndex !== null);
      }
      if (!focused) refuse("Could not move keyboard focus into Claude Code's agent selector.");
      if (inputTargetFromSelector(state) === 'unknown') refuse(UNRECOGNIZED_REASON);
    }

    if (!mainFilled(state)) {
      let moves = 0;
      while (state.cursorIndex !== state.mainIndex) {
        if (moves >= state.rows.length + 1 || state.mainIndex === null) refuse('Could not move the selector cursor to "main".');
        const before = state.cursorIndex;
        await press(before !== null && before > (state.mainIndex as number) ? 'Up' : 'Down');
        moves += 1;
        await settle((current) => current.cursorIndex !== before);
      }
      await press('Enter');
      if (!(await settle(mainFilled))) {
        refuse('Pressing Enter on "main" did not switch Claude Code\'s input to the main agent.');
      }
    }

    await press('Escape');
    await settle((current) => current.cursorIndex === null);
    if (state.cursorIndex !== null) {
      refuse('Claude Code kept keyboard focus in the agent selector, so the message was not sent.');
    }
    if (inputTargetFromSelector(state) !== 'main') {
      refuse("After leaving the agent selector, Claude Code's input was no longer on the main agent, so the message was not sent.");
    }

    if (from) {
      console.log(`[input-target] ${agentId}: switched input from subagent "${from}" to main`);
      return { ok: true, check: 'switched', switchedFromSubagent: from };
    }
    return { ok: true, check: 'already-main' };
  } catch (error) {
    if (!(error instanceof EnsureMainRefusal)) throw error;
    return { ok: false, reason: error.message, inputTarget: readFailed ? 'unknown' : inputTargetFromSelector(state) };
  }
}
