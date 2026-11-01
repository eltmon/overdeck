/**
 * The scheduled-messages tick (PAN-4641 WI-6, FR-7 … FR-12, FR-14, NFR-5).
 *
 * One tick runs every `SCHEDULED_MESSAGES_INTERVAL_MS` from the dashboard
 * patrol host. For each conversation with due work it acts on the head row
 * only (queue order, FR-10):
 *
 * - a `sent` head gets its outcome checked against the transcript: a newer
 *   reply confirms it, a newer usage-limit error re-arms it, and silence past
 *   `OUTCOME_WINDOW_MS` is taken as delivered;
 * - a due `pending` head is re-armed if the conversation is still limited with
 *   a known future reset; otherwise it is claimed, the session is resumed if
 *   it ended, a blocking choice menu defers it, and the delivery door pastes it.
 *
 * The delivery door's answer decides the row: 2xx → `sent`, 409 → back to
 * `pending`, other 4xx → `failed`, 5xx or a throw → `unknown`. An `unknown`
 * row is never re-pasted automatically (at-most-once, NFR-5).
 */
import { emitActivityEntry } from '../activity-logger.js';
import { paneHasBlockingChoiceMenu } from '../pane-choice-menu.js';
import { resolveAgentPaneIo } from '../terminal-backends/agent-pane-io.js';
import { handleConversationMessage } from './conversation-message.js';
import { resolveSessionFile } from './conversation-reads.js';
import { handleConversationResume } from './conversation-runtime.js';
import { conversationHarnessAlive } from './conversation-liveness.js';
import {
  claimScheduledMessage,
  computeNotBefore,
  failScheduledMessage,
  headScheduledMessage,
  listConversationsWithDueWork,
  markScheduledDelivered,
  markScheduledSent,
  pruneDeliveredScheduledMessages,
  rearmScheduledMessage,
  releaseScheduledToPending,
  type ScheduledMessage,
} from './conversation-scheduled-messages.js';
import { readConversationUsageLimit, readDeliveryOutcome } from './conversation-usage-limit.js';
import { getConversationByName, type LegacyConversation as Conversation } from './conversations.js';

export const SCHEDULED_MESSAGES_INTERVAL_MS = 60_000;
export const OUTCOME_WINDOW_MS = 10 * 60_000;

export interface DoorResponse {
  status: number;
  body: unknown;
}

export interface ScheduledDeliveryDeps {
  now?: () => number;
  readUsageLimit?: typeof readConversationUsageLimit;
  readOutcome?: typeof readDeliveryOutcome;
  harnessAlive?: (tmuxSession: string) => Promise<boolean>;
  resume?: (name: string) => Promise<DoorResponse>;
  paneBlocked?: (tmuxSession: string) => Promise<boolean>;
  deliver?: (name: string, text: string) => Promise<DoorResponse>;
  emit?: typeof emitActivityEntry;
  log?: (message: string) => void;
}

/** The status and JSON body of a door's `jsonResponse(...)`. */
export function decodeDoorResponse(response: { status: number; body: unknown }): DoorResponse {
  const body = response.body as { _tag?: unknown; body?: unknown } | null;
  if (body?._tag === 'Uint8Array' && body.body instanceof Uint8Array) {
    try {
      return { status: response.status, body: JSON.parse(new TextDecoder().decode(body.body)) as unknown };
    } catch {
      return { status: response.status, body: {} };
    }
  }
  return { status: response.status, body: {} };
}

async function defaultResume(name: string): Promise<DoorResponse> {
  return decodeDoorResponse(await handleConversationResume(name, {}, { resolveSessionFile }));
}

async function defaultDeliver(name: string, text: string): Promise<DoorResponse> {
  return decodeDoorResponse(await handleConversationMessage(name, { message: text }, {
    resolveSessionFile,
    generateAiTitle: async () => {},
  }));
}

/** Reads the pane on either terminal backend (Herdr or tmux); an unreadable pane is not blocked. */
async function defaultPaneBlocked(tmuxSession: string): Promise<boolean> {
  const pane = await resolveAgentPaneIo(tmuxSession)
    .then((io) => io.read(90))
    .catch(() => '');
  return Boolean(pane) && paneHasBlockingChoiceMenu(pane);
}

/** The door said the text never reached the terminal (`deliveryUnknown: false`), so a retry cannot duplicate it. */
function knownNotDelivered(body: unknown): boolean {
  return (body as { deliveryUnknown?: unknown } | null)?.deliveryUnknown === false;
}

function errorOf(body: unknown): string | null {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error : null;
}

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

interface TickContext {
  now: number;
  deps: ScheduledDeliveryDeps;
  emit: typeof emitActivityEntry;
  actions: string[];
}

function titleOf(conv: Conversation): string {
  return conv.title ?? conv.name;
}

async function checkSentOutcome(conv: Conversation, head: ScheduledMessage, ctx: TickContext): Promise<void> {
  const { now, deps, emit, actions } = ctx;
  const sentAtMs = head.sentAt ? Date.parse(head.sentAt) : now;
  const outcome = await (deps.readOutcome ?? readDeliveryOutcome)(conv, sentAtMs);
  if (outcome.kind === 'limited-again') {
    const next = computeNotBefore({ limited: true, ...outcome.usageLimit, errorAt: '' }, now);
    const rearmed = rearmScheduledMessage(head.id, now, next, { countAttempt: true });
    const message = rearmed.status === 'failed'
      ? `Queued message for "${titleOf(conv)}" hit the limit again; ${rearmed.lastError ?? 'gave up'}`
      : `Queued message for "${titleOf(conv)}" hit the limit again; it will retry at about ${clockTime(next.notBefore)}`;
    emit({ source: 'dashboard', level: 'warn', message, link: `/conv/${conv.id}` });
    actions.push(`${conv.name}: #${head.id} limited again → ${rearmed.status}`);
    return;
  }
  if (outcome.kind === 'confirmed') {
    markScheduledDelivered(head.id, now);
    actions.push(`${conv.name}: #${head.id} delivered`);
    return;
  }
  if (now - sentAtMs >= OUTCOME_WINDOW_MS) {
    markScheduledDelivered(head.id, now, 'no transcript confirmation');
    actions.push(`${conv.name}: #${head.id} delivered (no transcript confirmation)`);
  }
}

async function deliverPendingHead(conv: Conversation, head: ScheduledMessage, ctx: TickContext): Promise<void> {
  const { now, deps, emit, actions } = ctx;
  const limit = await (deps.readUsageLimit ?? readConversationUsageLimit)(conv);
  if (limit?.limited && limit.resetsAt) {
    rearmScheduledMessage(head.id, now, computeNotBefore(limit, now), { countAttempt: false });
    actions.push(`${conv.name}: #${head.id} still limited until ${limit.resetsAt}`);
    return;
  }
  if (!claimScheduledMessage(head.id, now)) return;

  // Every exit from the claimed section must leave the row out of `sending`:
  // a throw before the paste puts it back to `pending`, one after it to `unknown`.
  let pasteAttempted = false;
  try {
    await deliverClaimedHead(conv, head, ctx, () => { pasteAttempted = true; });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (pasteAttempted) {
      failScheduledMessage(head.id, now, 'unknown', reason);
      emit({ source: 'dashboard', level: 'warn', message: `Queued message for "${titleOf(conv)}" may not have been delivered: ${reason}`, link: `/conv/${conv.id}` });
      actions.push(`${conv.name}: #${head.id} unknown (${reason})`);
    } else {
      releaseScheduledToPending(head.id, now, reason, now + SCHEDULED_MESSAGES_INTERVAL_MS);
      actions.push(`${conv.name}: #${head.id} back to pending (${reason})`);
    }
  }
}

/**
 * Retry a row that certainly did not reach the terminal (resume failed, or the
 * door refused the paste) at the next tick, counting the attempt so a
 * conversation that never recovers ends `failed` instead of retrying forever.
 */
function retryCounted(conv: Conversation, head: ScheduledMessage, ctx: TickContext, reason: string): void {
  const { now, emit, actions } = ctx;
  const next = { notBefore: now + SCHEDULED_MESSAGES_INTERVAL_MS, resetSource: head.resetSource, limitWindow: head.limitWindow };
  const rearmed = rearmScheduledMessage(head.id, now, next, { countAttempt: true });
  if (rearmed.status === 'failed') {
    emit({ source: 'dashboard', level: 'warn', message: `Queued message for "${titleOf(conv)}" was not sent: ${reason}; ${rearmed.lastError ?? 'gave up'}`, link: `/conv/${conv.id}` });
  } else {
    releaseScheduledToPending(head.id, now, reason);
  }
  actions.push(`${conv.name}: #${head.id} not sent (${reason}) → ${rearmed.status}`);
}

async function deliverClaimedHead(conv: Conversation, head: ScheduledMessage, ctx: TickContext, markPasteAttempted: () => void): Promise<void> {
  const { now, deps, emit, actions } = ctx;
  const harnessAlive = deps.harnessAlive ?? ((session: string) => conversationHarnessAlive(session));
  if (conv.status === 'ended' || !(await harnessAlive(conv.tmuxSession))) {
    const resumed = await (deps.resume ?? defaultResume)(conv.name).catch((error: unknown) => ({
      status: 500,
      body: { error: error instanceof Error ? error.message : String(error) },
    }));
    if (resumed.status < 200 || resumed.status >= 300) {
      retryCounted(conv, head, ctx, `resume failed: ${errorOf(resumed.body) ?? `status ${resumed.status}`}`);
      return;
    }
  }

  if (await (deps.paneBlocked ?? defaultPaneBlocked)(conv.tmuxSession)) {
    releaseScheduledToPending(head.id, now, 'waiting: a choice menu is open in the conversation');
    actions.push(`${conv.name}: #${head.id} deferred (choice menu open)`);
    return;
  }

  markPasteAttempted();
  const delivered = await (deps.deliver ?? defaultDeliver)(conv.name, head.text).catch((error: unknown) => ({
    status: 500,
    body: { error: error instanceof Error ? error.message : String(error) },
  }));
  const link = `/conv/${conv.id}`;
  if (delivered.status >= 200 && delivered.status < 300) {
    markScheduledSent(head.id, now);
    emit({ source: 'dashboard', level: 'info', message: `Sent your queued message to "${titleOf(conv)}"`, link });
    actions.push(`${conv.name}: #${head.id} sent`);
  } else if (delivered.status === 409) {
    releaseScheduledToPending(head.id, now, errorOf(delivered.body) ?? 'conflict');
    actions.push(`${conv.name}: #${head.id} conflict, retrying next tick`);
  } else if (delivered.status < 500) {
    const reason = errorOf(delivered.body) ?? `status ${delivered.status}`;
    failScheduledMessage(head.id, now, 'failed', reason);
    emit({ source: 'dashboard', level: 'warn', message: `Queued message for "${titleOf(conv)}" could not be sent: ${reason}`, link });
    actions.push(`${conv.name}: #${head.id} failed (${reason})`);
  } else if (knownNotDelivered(delivered.body)) {
    retryCounted(conv, head, ctx, errorOf(delivered.body) ?? `status ${delivered.status}`);
  } else {
    const reason = errorOf(delivered.body) ?? 'delivery not confirmed';
    failScheduledMessage(head.id, now, 'unknown', reason);
    emit({ source: 'dashboard', level: 'warn', message: `Queued message for "${titleOf(conv)}" may not have been delivered: ${reason}`, link });
    actions.push(`${conv.name}: #${head.id} unknown (${reason})`);
  }
}

async function tickConversation(name: string, ctx: TickContext): Promise<void> {
  const head = headScheduledMessage(name);
  if (!head || head.status === 'failed' || head.status === 'unknown') return;
  const conv = getConversationByName(name);
  if (!conv) return;
  if (head.status === 'sent') {
    await checkSentOutcome(conv, head, ctx);
    return;
  }
  if (head.status !== 'pending') return;
  if (Date.parse(head.notBefore) > ctx.now) return;
  await deliverPendingHead(conv, head, ctx);
}

/** One pass over every conversation with due work. Returns one line per action taken. */
export async function tickScheduledMessages(deps: ScheduledDeliveryDeps = {}): Promise<string[]> {
  const now = (deps.now ?? Date.now)();
  const log = deps.log ?? console.log;
  const ctx: TickContext = { now, deps, emit: deps.emit ?? emitActivityEntry, actions: [] };
  pruneDeliveredScheduledMessages(now);
  for (const name of listConversationsWithDueWork(now)) {
    try {
      await tickConversation(name, ctx);
    } catch (error) {
      log(`[scheduled-messages] ${name}: tick failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return ctx.actions;
}
