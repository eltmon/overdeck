/**
 * paneChoice — PAN-3113 frontend vocabulary for blocking numbered-choice
 * menus parsed from a conversation's pane (the Claude Code session-resume
 * gate et al.). The server payload rides the pending-input feed; answering
 * posts the 0-based option index plus the menu signature back, and the server
 * refuses on any drift rather than send keystrokes into a different prompt.
 */
import { fetchWithTimeout } from './apiFetch';

export interface PendingPaneChoiceOption {
  number: number;
  label: string;
  recommended: boolean;
}

export interface PendingPaneChoice {
  signature: string;
  title: string;
  contextLines: string[];
  options: PendingPaneChoiceOption[];
  selectedIndex: number;
  footerHint: string | null;
  confidence: 'high' | 'low';
}

export type PaneChoiceAnswerResult =
  | { ok: true; answeredLabel: string }
  | { ok: false; error: string; code?: string };

/**
 * A choice the operator answered from the dashboard during this mount. Kept
 * in component state by the conversation panel so the timeline can show the
 * resolved "Answered" row after the pending feed stops reporting the menu.
 */
export interface AnsweredPaneChoice {
  signature: string;
  label: string;
  at: string;
}

export async function answerConversationPaneChoice(
  conversationId: string,
  selectedIndex: number,
  signature: string,
): Promise<PaneChoiceAnswerResult> {
  try {
    const res = await fetchWithTimeout(
      `/api/conversations/${encodeURIComponent(conversationId)}/pane-choice`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedIndex, signature }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && body['ok'] === true) {
      return { ok: true, answeredLabel: String(body['answeredLabel'] ?? '') };
    }
    return {
      ok: false,
      error: typeof body['error'] === 'string' ? body['error'] : `Request failed (${res.status})`,
      code: typeof body['code'] === 'string' ? body['code'] : undefined,
    };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : 'Network error' };
  }
}
