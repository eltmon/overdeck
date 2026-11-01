/**
 * pendingInputAnswer — the one place that decides how an AskUserQuestion
 * answer reaches its subject (PAN-2355 FR-8, D-12).
 *
 * Four transports, chosen in this order:
 *   1. Codex approval (`toolUseId` starts with `codex-approval:`) →
 *      `POST /api/conversations/:id/codex-approval` with `{ optionNumber, toolUseId }`.
 *   2. agent → `POST /api/agents/:id/answer-question` with `{ answers, toolUseId }`.
 *   3. a conversation whose harness declares `askAnswerDelivery: 'pi-ask-modal'`
 *      (ohmypi, and the legacy `pi` alias) → `POST /api/conversations/:id/pi-ask-answer`
 *      with `{ toolUseId, answers }` (PAN-3766 — a pi ask modal holds the
 *      session's input; a queued message is swallowed).
 *   4. any other conversation → `POST /api/conversations/:id/message` with the
 *      "Operator answered the pending question…" prose.
 *
 * The desktop dialog host and the phone Needs-you card both call it, so the
 * endpoints, bodies and headers stay identical across surfaces.
 */
import { getHarnessBehavior, type HarnessName } from '@overdeck/contracts';
import { fetchWithTimeout } from './apiFetch';

export type PendingAnswerTarget = {
  kind: 'agent' | 'conv';
  id: string;
  answers: string[];
  questions?: ReadonlyArray<{ question: string }>;
  /** Conversation harness; pi asks are answered by keystrokes. */
  harness?: string | null;
  toolUseId?: string;
};

export type PendingAnswerRequest = { url: string; body: Record<string, unknown> };

const CODEX_APPROVAL_PREFIX = 'codex-approval:';

/** The option number a Codex approval label starts with ("2. Allow" → 2). */
export function parseCodexOptionNumber(label: string): number | null {
  const match = /^\s*(\d+)/.exec(label);
  const optionNumber = match ? Number(match[1]) : NaN;
  return Number.isInteger(optionNumber) ? optionNumber : null;
}

export function buildPendingAnswerRequest(target: PendingAnswerTarget): PendingAnswerRequest | { error: string } {
  const { kind, id, answers, questions, harness, toolUseId } = target;
  if (toolUseId?.startsWith(CODEX_APPROVAL_PREFIX)) {
    const optionNumber = parseCodexOptionNumber(answers[0] ?? '');
    if (optionNumber === null) return { error: 'Could not determine which option was selected' };
    return {
      url: `/api/conversations/${encodeURIComponent(id)}/codex-approval`,
      body: { optionNumber, toolUseId },
    };
  }
  if (kind === 'agent') {
    return {
      url: `/api/agents/${encodeURIComponent(id)}/answer-question`,
      body: { answers, toolUseId },
    };
  }
  // An unknown or missing harness resolves to claude-code, which takes a message.
  if (getHarnessBehavior(harness as HarnessName | null | undefined).capabilities.askAnswerDelivery === 'pi-ask-modal') {
    return {
      url: `/api/conversations/${encodeURIComponent(id)}/pi-ask-answer`,
      body: { toolUseId, answers },
    };
  }
  const lines: string[] = [];
  const qArr = questions ?? [];
  for (let i = 0; i < answers.length && i < qArr.length; i++) {
    const q = qArr[i]?.question ?? `Question ${i + 1}`;
    lines.push(`Q: ${q}\nA: ${answers[i]}`);
  }
  const composed = `Operator answered the pending question${answers.length > 1 ? 's' : ''}:\n\n${lines.join('\n\n')}`;
  return {
    url: `/api/conversations/${encodeURIComponent(id)}/message`,
    body: { message: composed },
  };
}

/**
 * POST the request. A non-2xx response rejects with the server's `error`
 * field, or `<failureLabel> (<status>)` when the body has none.
 */
export async function postPendingAnswer(request: PendingAnswerRequest, failureLabel: string): Promise<unknown> {
  // fetchWithTimeout: a plain fetch that never resolves (e.g. server restart
  // mid-request) leaves isPending stuck true and every dialog button disabled
  // until a page refresh.
  const res = await fetchWithTimeout(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.body),
  });
  if (!res.ok) {
    let message = `${failureLabel} (${res.status})`;
    try { const body = await res.json() as { error?: string }; if (body?.error) message = body.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json();
}
