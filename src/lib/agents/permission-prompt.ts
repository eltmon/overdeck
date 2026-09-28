/**
 * PAN-4278: parse Claude Code's tool-permission prompt from a plain-text pane.
 *
 * Claude Code 2.1.280 replaces its input box with this block while a tool
 * call waits for permission (captured in `__fixtures__/claude-code-2.1.280/`):
 *
 *     ────────────────────────────────────────
 *      Bash command · from the general-purpose agent
 *
 *        Q=$(pwd)/queue; rm -f "$Q"/*
 *        Execute queue cleanup command
 *
 *      │ Dangerous rm operation on possibly-empty variable path: …
 *
 *      Do you want to proceed?
 *      ❯ 1. Yes
 *        2. No
 *
 *      Esc to cancel · Tab to amend
 *
 * A background subagent's prompt draws in the main view too; its title
 * carries ` · from the <type> agent`. The menu has 2 options (Yes / No) or 3
 * (Yes / Yes, and always allow … / No).
 *
 * The option block is parsed here rather than through `parsePaneChoiceMenu`:
 * that parser rejects labels over 100 characters and wrapped option rows, and
 * the "always allow" label names a path, which often exceeds both. The
 * acceptance rules stay as conservative — the prompt must be the bottom-most
 * surface of the pane, carry exactly one `❯` cursor row, and sit under a `───`
 * rule — because a false positive would offer to press keys into a pane that
 * is not asking anything.
 */

import { looksLikeHarnessFooterHint } from '../pane-choice-menu.js';
import type { SelectorKey } from '../terminal-backends/agent-pane-io.js';

export type PermissionChoice = 'allow-once' | 'allow-always' | 'deny';

export interface PermissionPromptOption {
  readonly index: number;        // position in options[]
  readonly number: number;       // number as rendered in the pane
  readonly label: string;
  readonly choice: PermissionChoice;
}

export interface PermissionPrompt {
  readonly signature: string;          // title line + detail + options; stable for one on-screen prompt
  readonly header: string;             // e.g. 'Bash command'
  readonly fromAgent: string | null;   // 'general-purpose' for ' · from the general-purpose agent', else null
  readonly detailLines: readonly string[];
  readonly reason: string | null;
  readonly options: readonly PermissionPromptOption[];
  readonly selectedIndex: number;      // index of the ❯ row
}

export type PermissionKey = Exclude<SelectorKey, 'Escape'>;

const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const OPTION_LINE = /^\s*([❯›])?\s*(\d)[.)]\s+(\S.*)$/;
const SEPARATOR_LINE = /^\s*[─━═]{6,}\s*$/;
const BARE_PROMPT_LINE = /^\s*[❯›]\s*$/;
const REASON_BAR = /^│\s*/;
const REASON_TEXT = /^(?:Dangerous|Warning|This command|.*cannot be auto-allowed)/i;
const QUESTION_LINE = /^do you want to\b/i;
const PERMISSION_TEXT = /permission|allow(?:\s+this)?|tool use|bash command|mcp tool|do you want to proceed|do you want to continue/i;
const ALLOW_ALWAYS_LABEL = /^yes,?\s*(?:and\s*)?(?:allow|don't ask|always)/i;
const FROM_AGENT_SUFFIX = /^(.*?)\s+·\s+from\s+(?:the\s+)?(.+?)(?:\s+agent)?$/i;

const MAX_TRAILING_LINES = 6;
const MAX_OPTION_SCAN = 24;
const MAX_BLOCK_LINES = 40;

function cleanLine(line: string): string {
  return line
    .replace(ANSI_PATTERN, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+$/g, '');
}

interface RawOption {
  cursor: boolean;
  number: number;
  label: string;
}

/**
 * Parse the permission prompt at the bottom of `paneText`, or null when the
 * pane is not currently blocked on one (including PAN-3113 choice menus and the
 * agent selector).
 */
export function parsePermissionPrompt(paneText: string): PermissionPrompt | null {
  if (!paneText) return null;
  const lines = paneText.split('\n').map(cleanLine);

  let end = lines.length - 1;
  while (end >= 0 && lines[end]!.trim() === '') end -= 1;
  if (end < 0) return null;

  // Option 1 ("Yes") is the anchor: the last one near the bottom of the pane.
  let first = -1;
  for (let i = end; i >= 0 && end - i <= MAX_OPTION_SCAN; i -= 1) {
    const match = OPTION_LINE.exec(lines[i]!);
    if (match && match[2] === '1' && /^yes\b/i.test(match[3]!.trim())) { first = i; break; }
  }
  if (first < 0) return null;

  // Options run downward from option 1; an indented non-numbered line directly
  // below an option continues its wrapped label. A blank line ends the block.
  const raw: RawOption[] = [];
  let i = first;
  for (; i <= end; i += 1) {
    const line = lines[i]!;
    if (line.trim() === '') break;
    const match = OPTION_LINE.exec(line);
    if (match && Number(match[2]) === raw.length + 1) {
      raw.push({ cursor: Boolean(match[1]), number: Number(match[2]), label: match[3]!.trim() });
      continue;
    }
    if (raw.length > 0 && /^\s/.test(line) && !SEPARATOR_LINE.test(line) && !BARE_PROMPT_LINE.test(line)) {
      raw[raw.length - 1]!.label += ` ${line.trim()}`;
      continue;
    }
    return null;
  }

  // Nothing but blank lines, rules and key hints may sit below the menu: real
  // output there means the prompt was answered or scrolled away.
  const trailing = lines.slice(i, end + 1).filter((line) => line.trim() !== '');
  if (trailing.length > MAX_TRAILING_LINES) return null;
  for (const line of trailing) {
    if (SEPARATOR_LINE.test(line)) continue;
    if (looksLikeHarnessFooterHint(line.trim())) continue;
    return null;
  }

  if (raw.length < 2 || raw.length > 3) return null;
  if (!/^no\b/i.test(raw[raw.length - 1]!.label)) return null;
  if (raw.length === 3 && !ALLOW_ALWAYS_LABEL.test(raw[1]!.label)) return null;
  const cursorRows = raw.flatMap((opt, index) => (opt.cursor ? [index] : []));
  if (cursorRows.length !== 1) return null;

  // The question sits directly above the options.
  let q = first - 1;
  while (q >= 0 && lines[q]!.trim() === '') q -= 1;
  if (q < 0) return null;
  const question = lines[q]!.trim();
  if (!QUESTION_LINE.test(question) && !PERMISSION_TEXT.test(question)) return null;

  // The prompt block starts under the nearest ─── rule above the question.
  let rule = -1;
  for (let j = q - 1; j >= 0 && q - j <= MAX_BLOCK_LINES; j -= 1) {
    if (SEPARATOR_LINE.test(lines[j]!)) { rule = j; break; }
  }
  if (rule < 0) return null;

  const block = lines.slice(rule + 1, q).map((line) => line.trim()).filter((line) => line !== '');
  if (block.length === 0) return null;
  const title = block[0]!;
  const fromMatch = FROM_AGENT_SUFFIX.exec(title);
  const header = fromMatch ? fromMatch[1]!.trim() : title;
  const fromAgent = fromMatch ? fromMatch[2]!.trim() : null;

  const detailLines: string[] = [];
  let reason: string | null = null;
  for (const line of block.slice(1)) {
    const text = line.replace(REASON_BAR, '');
    if (reason === null && REASON_TEXT.test(text)) { reason = text; continue; }
    detailLines.push(text);
  }

  const options: PermissionPromptOption[] = raw.map((opt, index) => ({
    index,
    number: opt.number,
    label: opt.label,
    choice: index === 0 ? 'allow-once' : index === raw.length - 1 ? 'deny' : 'allow-always',
  }));

  // The full title (with its "from the … agent" suffix) keeps a subagent's
  // prompt distinct from an identical main-thread prompt shown right after it.
  const signature = `${title}::${detailLines.join('\n')}::${options.map((o) => `${o.number}:${o.label}`).join('|')}`;

  return { signature, header, fromAgent, detailLines, reason, options, selectedIndex: cursorRows[0]! };
}

/**
 * Keys that answer `prompt` with `choice`: arrows from the ❯ row to the target
 * row, then Enter. Never digits (not guaranteed across versions) and never
 * Escape (it also dismisses other UI). Null when the prompt does not offer
 * `choice`.
 */
export function permissionKeystrokes(prompt: PermissionPrompt, choice: PermissionChoice): PermissionKey[] | null {
  const target = prompt.options.find((option) => option.choice === choice);
  if (!target) return null;
  const keys: PermissionKey[] = [];
  for (let i = prompt.selectedIndex; i < target.index; i += 1) keys.push('Down');
  for (let i = prompt.selectedIndex; i > target.index; i -= 1) keys.push('Up');
  keys.push('Enter');
  return keys;
}
