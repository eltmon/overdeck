import type { ComposerCommandResult } from '@overdeck/contracts';

export function isComposerCommandResult(value: unknown): value is ComposerCommandResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  switch (candidate.kind) {
    case 'captured':
      return (
        (candidate.status === 'completed' || candidate.status === 'failed') &&
        typeof candidate.command === 'string' &&
        typeof candidate.output === 'string' &&
        typeof candidate.truncated === 'boolean'
      );
    case 'activity':
      return (
        candidate.status === 'accepted' &&
        typeof candidate.command === 'string' &&
        typeof candidate.activityId === 'string' &&
        typeof candidate.message === 'string'
      );
    case 'ui':
      return (
        candidate.status === 'requires_ui' &&
        (candidate.action === 'handoff' || candidate.action === 'fork') &&
        candidate.args !== null &&
        typeof candidate.args === 'object'
      );
    case 'confirmation':
      return (
        candidate.status === 'confirmation_required' &&
        typeof candidate.nonce === 'string' &&
        typeof candidate.consequence === 'string' &&
        (candidate.typedText === undefined || typeof candidate.typedText === 'string')
      );
    case 'terminal-only':
      return candidate.status === 'rejected' && typeof candidate.message === 'string';
    default:
      return false;
  }
}

export interface ComposerCommandConfirmation {
  nonce: string;
  typedText?: string;
}

/**
 * Structured send failure. `status` is the HTTP status when the server
 * answered at all (undefined for network-level failures). `reason` is the
 * server-supplied error text when present. `retryable` is false for
 * deterministic rejections — a 4xx other than 408/429 will fail an identical
 * retry every time, so the outbox must not offer Retry for it (PAN-3117).
 */
export class MessageSendError extends Error {
  readonly status?: number;
  readonly reason?: string;
  readonly retryable: boolean;
  readonly deliveryUnknown: boolean;
  constructor(message: string, opts: { status?: number; reason?: string; deliveryUnknown?: boolean; retryable?: boolean }) {
    super(message);
    this.name = 'MessageSendError';
    this.status = opts.status;
    this.reason = opts.reason;
    this.deliveryUnknown = opts.deliveryUnknown ?? (opts.status === undefined || opts.status >= 500 || opts.status === 408);
    this.retryable = opts.retryable ?? (opts.status === undefined
      || opts.status >= 500
      || opts.status === 408
      || opts.status === 429);
  }
}

export interface SendFailureDetails {
  error?: string;
  retryable?: boolean;
  deliveryUnknown?: boolean;
  clientMessageId?: string;
  deliverAs?: 'steer' | 'follow_up';
}

/** Extract the display reason + retryability the outbox preserves from any send failure. */
export function sendFailureDetails(err: unknown): SendFailureDetails {
  if (err instanceof MessageSendError) {
    return { error: err.reason ?? err.message, retryable: err.retryable, deliveryUnknown: err.deliveryUnknown };
  }
  return { error: err instanceof Error ? err.message : String(err), retryable: true, deliveryUnknown: true };
}

/**
 * POST a message to a conversation (or agent) session. The single source of
 * truth for the send endpoint + payload, used by both the composer's first send
 * (ComposerFooter.handleSubmit), confirmation resubmissions, and the failed-
 * message retry below. Structured command results are returned even when their
 * HTTP status is non-2xx (for example terminal-only rejection), while ordinary
 * transport failures still throw so callers can preserve the text in the retry
 * outbox.
 */
export async function sendConversationMessage(
  conversationName: string,
  message: string,
  agentId?: string,
  deliverAs?: 'steer' | 'follow_up',
  confirmation?: ComposerCommandConfirmation,
  options?: { clientMessageId?: string; retry?: boolean },
): Promise<ComposerCommandResult | null> {
  const endpoint = agentId
    ? `/api/agents/${encodeURIComponent(agentId)}/message`
    : `/api/conversations/${encodeURIComponent(conversationName)}/message`;
  const payload = {
    message,
    ...options,
    ...(deliverAs && !agentId ? { deliverAs } : {}),
    ...(confirmation ? {
      confirmationNonce: confirmation.nonce,
      ...(confirmation.typedText !== undefined
        ? { confirmationText: confirmation.typedText }
        : {}),
    } : {}),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // A connection failure cannot prove whether delivery happened. Retry is
      // safe only when the conversation endpoint has a stable receipt identity.
      throw new MessageSendError(
        `Delivery not confirmed: ${err instanceof Error ? err.message : String(err)}`,
        { retryable: !agentId && !!options?.clientMessageId },
      );
    }
    let body: string;
    try {
      body = await res.text();
    } catch {
      throw new MessageSendError('Delivery not confirmed: the response was interrupted.', {
        retryable: !agentId && !!options?.clientMessageId,
      });
    }
    let responseBody: unknown = null;
    if (body) {
      try {
        responseBody = JSON.parse(body);
      } catch {
        responseBody = null;
      }
    }
    if (isComposerCommandResult(responseBody)) return responseBody;
    if (!res.ok) {
      const error = responseBody && typeof responseBody === 'object' &&
        'error' in responseBody && typeof responseBody.error === 'string'
        ? responseBody.error
        : body;
      const details = responseBody && typeof responseBody === 'object' ? responseBody as Record<string, unknown> : {};
      const deliveryUnknown = typeof details.deliveryUnknown === 'boolean' ? details.deliveryUnknown
        : res.status >= 500 || res.status === 408;
      throw new MessageSendError(
        `${deliveryUnknown ? 'Delivery not confirmed' : 'Failed to send message'} (${res.status})${error ? `: ${error}` : ''}`,
        { status: res.status, reason: error || undefined, deliveryUnknown,
          ...(deliveryUnknown && (agentId || !options?.clientMessageId) ? { retryable: false }
            : typeof details.retryable === 'boolean' ? { retryable: details.retryable } : {}),
        },
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

