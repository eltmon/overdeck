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
 * PAN-3228 extracts the session-scoped capture, signature verification, and
 * keystroke delivery into session-pane-choice.ts so agents and conversations
 * share one safe answer path.
 *
 * On a Herdr host detection is skipped unless the caller passes a captured
 * screen (PAN-5169).
 */
import {
  getConversationById,
  getConversationByName,
  type LegacyConversation as Conversation,
} from './conversations.js';
import { clearedConversationRefusal, isSupersededConversation } from './conversation-clear-chain.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import {
  answerSessionPaneChoice,
  captureSessionPaneChoice,
  type PendingPaneChoice,
  type SessionPaneChoiceDeps,
} from '../session-pane-choice.js';
import { hostTerminalBackendName } from '../terminal-backends/select.js';
import type { TerminalBackendName } from '../terminal-backends/types.js';
import { tmuxSessionExists } from './conversation-runtime.js';

export type { PendingPaneChoice, PendingPaneChoiceOption } from '../session-pane-choice.js';

function isClaudeCodeConversation(conv: Conversation): boolean {
  return getHarnessBehavior(conv.harness).transcriptKind === 'claude-jsonl';
}

/** Parse the conversation's current pane for a blocking numbered-choice menu. */
export async function claudeConversationPaneChoice(
  conv: Conversation,
  options: {
    capture?: (sessionName: string, lines: number) => Promise<string>;
    /** Test seam; production reads the host backend. */
    hostBackend?: () => Promise<TerminalBackendName>;
  } = {},
): Promise<PendingPaneChoice | null> {
  if (!isClaudeCodeConversation(conv)) return null;
  // PAN-5169: the answer path is tmux-only, so a Herdr host neither captures
  // (a tmux spawn per conversation per poll) nor reports a menu it cannot answer.
  if (!options.capture && (await (options.hostBackend ?? hostTerminalBackendName)()) === 'herdr') return null;
  return captureSessionPaneChoice(conv.tmuxSession, options.capture);
}

/**
 * POST /api/conversations/:id/pane-choice — resolve a conversation and delegate
 * its live pane menu to the shared session-scoped answer core.
 */
export async function handleConversationPaneChoiceAnswer(
  rawId: string,
  body: Record<string, unknown>,
  deps: SessionPaneChoiceDeps = {},
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
    // PAN-4485: a superseded /clear row answers nothing; its chain head does.
    if (isSupersededConversation(conv)) return { body: clearedConversationRefusal(conv), status: 409 };

    return answerSessionPaneChoice(conv.tmuxSession, { selectedIndex, signature }, {
      ...deps,
      sessionExists: deps.sessionExists ?? tmuxSessionExists,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] pane-choice answer failed:', msg);
    return { body: { error: 'Internal server error' }, status: 500 };
  }
}
