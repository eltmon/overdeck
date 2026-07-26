/**
 * PAN-3113 — surface blocking numbered-choice menus in claude-code
 * conversation panes (the session-resume gate is the driving case) as
 * actionable pending input, and answer them from the dashboard.
 *
 * Detection is request-driven, not a patrol: the pending-input feed already
 * polls every few seconds, so detection rides that cycle — when the menu
 * disappears (answered from the dashboard OR directly in the terminal) the
 * next poll simply stops reporting it. No server-side state machine, no
 * stale records.
 *
 * Answering re-captures uncached, verifies the menu the operator saw is still
 * the menu on screen (signature match), drives the selection with literal
 * keystrokes (Up/Down + Enter via sendRawKeystroke), then re-captures to
 * confirm the menu dismissed — the same contract as the Codex TUI approval
 * flow (`handleConversationCodexApproval`).
 */
import { Effect } from 'effect';
import {
  getConversationById,
  getConversationByName,
  type LegacyConversation as Conversation,
} from './conversations.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { capturePaneText, sendRawKeystroke } from '../tmux.js';
import { tmuxSessionExists } from './conversation-runtime.js';
import {
  buildChoiceKeystrokes,
  paneChoiceMenuSignature,
  parsePaneChoiceMenu,
  type PaneChoiceConfidence,
} from '../pane-choice-menu.js';

const PANE_CAPTURE_LINES = 90;
const KEYSTROKE_GAP_MS = 60;
const DELIVERY_CONFIRM_WAIT_MS = 700;

export interface PendingPaneChoiceOption {
  number: number;
  label: string;
  recommended: boolean;
}

export interface PendingPaneChoice {
  /** Stable identity of the parsed menu — answers must match what is on screen. */
  signature: string;
  title: string;
  contextLines: string[];
  options: PendingPaneChoiceOption[];
  selectedIndex: number;
  footerHint: string | null;
  confidence: PaneChoiceConfidence;
}

function isClaudeCodeConversation(conv: Conversation): boolean {
  return getHarnessBehavior(conv.harness).transcriptKind === 'claude-jsonl';
}

/**
 * Parse the conversation's current pane for a blocking numbered-choice menu.
 * Returns null when the conversation is not claude-code, the capture fails,
 * or no menu is on screen. Detection-only callers (the pending-input feed)
 * use the shared cached capture; the answer path captures uncached.
 */
export async function claudeConversationPaneChoice(
  conv: Conversation,
  options: { capture?: (sessionName: string, lines: number) => Promise<string> } = {},
): Promise<PendingPaneChoice | null> {
  if (!isClaudeCodeConversation(conv)) return null;
  const capture = options.capture ?? ((sessionName: string, lines: number) => capturePaneText(sessionName, lines));
  let pane: string;
  try {
    pane = await capture(conv.tmuxSession, PANE_CAPTURE_LINES);
  } catch {
    return null;
  }
  const menu = parsePaneChoiceMenu(pane);
  if (!menu) return null;
  return {
    signature: paneChoiceMenuSignature(menu),
    title: menu.title,
    contextLines: menu.contextLines,
    options: menu.options.map((o) => ({ number: o.number, label: o.label, recommended: o.recommended })),
    selectedIndex: menu.selectedIndex,
    footerHint: menu.footerHint,
    confidence: menu.confidence,
  };
}

/**
 * POST /api/conversations/:id/pane-choice — answer the live pane menu.
 *
 * Body: `{ selectedIndex: number (0-based), signature: string }`. The
 * signature must match the menu currently on screen, or the operator answered
 * a stale card and we refuse (409) rather than send keystrokes into a
 * different prompt. Returns a plain `{ body, status }` for the route to
 * serialize — the same shape as the conversation-read handlers, so the
 * contract is unit-testable without an HTTP layer.
 */
export async function handleConversationPaneChoiceAnswer(
  rawId: string,
  body: Record<string, unknown>,
  deps: {
    capture?: (sessionName: string, lines: number) => Promise<string>;
    sendKey?: (sessionName: string, key: string) => Promise<void>;
    sleep?: (ms: number) => Promise<void>;
    sessionExists?: (sessionName: string) => Promise<boolean>;
  } = {},
): Promise<{ body: Record<string, unknown>; status?: number }> {
  try {
    const selectedIndex = Number(body['selectedIndex']);
    const signature = typeof body['signature'] === 'string' ? body['signature'] : '';
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 8) {
      return { body: { error: 'selectedIndex must be an integer 0-8' }, status: 400 };
    }
    if (!signature) {
      return { body: { error: 'signature is required' }, status: 400 };
    }
    const numericId = Number(rawId);
    const conv = !Number.isNaN(numericId) && /^\d+$/.test(rawId)
      ? getConversationById(numericId)
      : getConversationByName(rawId);
    if (!conv) {
      return { body: { error: 'Conversation not found' }, status: 404 };
    }
    if (!isClaudeCodeConversation(conv)) {
      return { body: { error: 'Not a Claude Code conversation' }, status: 400 };
    }
    const sessionExists = deps.sessionExists ?? tmuxSessionExists;
    if (!(await sessionExists(conv.tmuxSession))) {
      return { body: { error: 'Conversation session is not running' }, status: 409 };
    }

    const capture = deps.capture ?? ((sessionName: string, lines: number) => capturePaneText(sessionName, lines));
    const sendKey = deps.sendKey
      ?? ((sessionName: string, key: string) => Effect.runPromise(sendRawKeystroke(sessionName, key, 'pane-choice')));
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    // Re-parse uncached so keystrokes go to the menu that is on screen NOW.
    const pane = await capture(conv.tmuxSession, PANE_CAPTURE_LINES);
    const menu = parsePaneChoiceMenu(pane);
    if (!menu) {
      return { body: { error: 'The choice menu is no longer on screen', code: 'menu-gone' }, status: 409 };
    }
    if (paneChoiceMenuSignature(menu) !== signature) {
      return { body: { error: 'The choice menu changed since the card was rendered — refresh and re-answer', code: 'menu-changed' }, status: 409 };
    }
    if (selectedIndex >= menu.options.length) {
      return { body: { error: `selectedIndex out of range (0-${menu.options.length - 1})` }, status: 400 };
    }

    const keys = buildChoiceKeystrokes(menu, selectedIndex);
    for (const key of keys) {
      await sendKey(conv.tmuxSession, key);
      await sleep(KEYSTROKE_GAP_MS);
    }

    // Confirm the menu dismissed before reporting success — a card that says
    // "answered" while the pane still waits would silently re-block.
    await sleep(DELIVERY_CONFIRM_WAIT_MS);
    const after = parsePaneChoiceMenu(await capture(conv.tmuxSession, PANE_CAPTURE_LINES));
    if (after && paneChoiceMenuSignature(after) === signature) {
      return { body: { error: 'Keystrokes were sent but the menu is still on screen — answer it from the terminal', code: 'delivery-unconfirmed' }, status: 409 };
    }
    return { body: { ok: true, answeredLabel: menu.options[selectedIndex]!.label } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] pane-choice answer failed:', msg);
    return { body: { error: 'Internal server error' }, status: 500 };
  }
}
