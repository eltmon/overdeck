/**
 * A Codex conversation's failed last turn as a `providerError` (PAN-5633 WI-3).
 *
 * Codex records a failed turn in its rollout as a `task_complete` carrying
 * `error` (read by `readCodexLastTurn`). The conversation list turns it into the
 * same `ConversationProviderError` Claude Code rows use, so the Agents Live view
 * shows it as a Needs-you row with an operator sentence instead of raw text.
 *
 * Healing rule: an auth failure older than the last write of
 * `~/.codex/auth.json` is recovered — someone signed in again after it, and the
 * running app-server re-reads the shared store, so a new message resumes.
 */
import { readCodexLastTurn, type CodexTurnFailure } from '../conversations/codex-thread-status.js';
import type { ConversationProviderError } from './conversation-provider-error.js';

const MESSAGE_MAX = 300;

function operatorMessage(failure: CodexTurnFailure, authRecovered: boolean): string {
  switch (failure.kind) {
    case 'auth':
      return authRecovered
        ? `Codex sign-in is fixed. Send a message to resume. Last error: ${failure.message}`
        : `Codex sign-in failed. Re-authenticate from the Codex banner. Last error: ${failure.message}`;
    case 'context-window':
      return `The context window is full and compaction failed. Hand this conversation off to a new one. Last error: ${failure.message}`;
    default:
      return failure.message;
  }
}

export function codexProviderErrorFromFailure(failure: CodexTurnFailure, nativeAuthMtimeMs: number | null): ConversationProviderError {
  const isAuth = failure.kind === 'auth';
  const authRecovered = isAuth && nativeAuthMtimeMs !== null && nativeAuthMtimeMs > Date.parse(failure.at);
  return {
    message: operatorMessage(failure, authRecovered).slice(0, MESSAGE_MAX),
    at: failure.at,
    status: null,
    code: failure.code,
    usageLimit: null,
    kind: failure.kind,
    ...(isAuth ? { authRecovered } : {}),
  };
}

/** The rollout's newest turn as a providerError; null when it did not fail or cannot be read. */
export async function readCodexConversationProviderError(
  rolloutPath: string,
  nativeAuthMtimeMs: number | null,
): Promise<ConversationProviderError | null> {
  try {
    const { failure } = await readCodexLastTurn(rolloutPath);
    return failure ? codexProviderErrorFromFailure(failure, nativeAuthMtimeMs) : null;
  } catch {
    return null;
  }
}
