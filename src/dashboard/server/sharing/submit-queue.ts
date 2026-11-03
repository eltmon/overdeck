/**
 * One share's strict-FIFO prompt queue (PRD PAN-4476 WI-4, FR-8, FR-9).
 *
 * Contributor submits and controller sends wait here in arrival order. The queue delivers one prompt,
 * waits for the agent's turn to start and end, then delivers the next, so two shared prompts never
 * land in one turn. Turn detection is polled (D-6): one QUEUE_TICK_MS timer, re-armed after each async
 * tick, reads `activity()`. After a delivery the queue waits for `working`, a changed last message id
 * or TURN_START_TIMEOUT_MS (D-7), then for `working` to read false, then stays idle for one tick before
 * the next delivery.
 *
 * Delivery outcomes copy the scheduled-messages door rule: 2xx sent; 409 keeps the head for the next
 * tick; any other 4xx is refused; 5xx or a throw is unknown and never re-delivered (at-most-once).
 * Nothing is persisted (D-15), nothing here logs prompt text (NFR-5), and the terminal is reached only
 * through the delivery door (NFR-6).
 */
import {
  sharedPromptRefusal,
  type ShareIdentity,
  type ShareQueueView,
  type SharedSubmitReason,
} from '@overdeck/contracts';

import { handleConversationMessage } from '../../../lib/overdeck/conversation-message.js';
import { resolveSessionFile } from '../../../lib/overdeck/conversation-reads.js';
import { decodeDoorResponse } from '../../../lib/overdeck/scheduled-message-delivery.js';
import { summarizeConversationActivity } from '../services/conversation/activity-summary.js';
import { resolveClaudeSessionFile } from './conversation-bridge.js';

export const QUEUE_TICK_MS = 1_000;
export const TURN_START_TIMEOUT_MS = 30_000;
export const QUEUE_MAX_ITEMS = 20;
export const QUEUE_MAX_PER_AUTHOR = 3;
/** How long production deps reuse a resolved transcript path before looking it up again. */
export const SESSION_FILE_CACHE_MS = 30_000;

export interface QueuedPrompt {
  readonly id: string; // host id: `${source}-${counter}`
  readonly clientId: string | null;
  readonly source: 'contributor' | 'controller';
  readonly author: ShareIdentity | null;
  readonly text: string;
  readonly enqueuedAt: number;
}

export type DoorAnswer = { status: number; body: unknown };

export interface SubmitQueueDeps {
  deliver(text: string): Promise<DoorAnswer>;
  activity(): Promise<{ working: boolean; lastMessageId: string | null }>;
  now(): number;
}

export interface SubmitQueueEvents {
  /** Called right before a delivery; returns an undo for a delivery that did not happen (D-10). */
  onDelivering(item: QueuedPrompt): () => void;
  onOutcome(item: QueuedPrompt, outcome: 'sent' | SharedSubmitReason): void;
  /** Called only when `agentWorking` or `queued` changed. */
  onStatus(status: { agentWorking: boolean; queued: number }): void;
}

export type EnqueueResult =
  | { ok: true; id: string; position: number }
  | { ok: false; reason: 'invalid_prompt' | 'too_long' | 'queue_full' };

type Phase = 'idle' | 'awaiting-start' | 'awaiting-end';

export class SubmitQueue {
  private readonly items: QueuedPrompt[] = [];
  private delivering: QueuedPrompt | null = null;
  /** The delivering item's author lost the grant mid-delivery: a 409 must not put it back. */
  private deliveringRevoked = false;
  private phase: Phase = 'idle';
  private startMark: { lastMessageId: string | null; at: number } = { lastMessageId: null, at: 0 };
  private agentWorking = false;
  private status = { agentWorking: false, queued: 0 };
  private watching = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;
  private counter = 0;
  private closed = false;

  constructor(
    private readonly deps: SubmitQueueDeps,
    private readonly events: SubmitQueueEvents,
  ) {}

  enqueue(item: Omit<QueuedPrompt, 'id' | 'enqueuedAt'>): EnqueueResult {
    const refusal = sharedPromptRefusal(item.text);
    if (refusal) return { ok: false, reason: refusal };
    if (this.closed || this.items.length + (this.delivering ? 1 : 0) >= QUEUE_MAX_ITEMS) return { ok: false, reason: 'queue_full' };
    if (item.source === 'contributor') {
      const githubId = item.author?.githubId;
      const mine = this.items.filter((queued) => queued.source === 'contributor' && queued.author?.githubId === githubId).length;
      if (mine >= QUEUE_MAX_PER_AUTHOR) return { ok: false, reason: 'queue_full' };
    }
    this.counter += 1;
    const queued: QueuedPrompt = { ...item, id: `${item.source}-${this.counter}`, enqueuedAt: this.deps.now() };
    this.items.push(queued);
    this.emitStatus();
    this.schedule();
    return { ok: true, id: queued.id, position: this.items.length };
  }

  /**
   * Removes the author's queued contributor items. The item being delivered stays in flight, but
   * if its delivery is answered 409 it is reported `grant_revoked` instead of going back on the queue.
   */
  dropAuthor(githubId: number): QueuedPrompt[] {
    const delivering = this.delivering;
    if (delivering?.source === 'contributor' && delivering.author?.githubId === githubId) this.deliveringRevoked = true;
    const dropped: QueuedPrompt[] = [];
    for (let index = this.items.length - 1; index >= 0; index--) {
      const item = this.items[index];
      if (item && item.source === 'contributor' && item.author?.githubId === githubId) {
        dropped.unshift(item);
        this.items.splice(index, 1);
      }
    }
    if (dropped.length > 0) this.emitStatus();
    return dropped;
  }

  /** The hub's "at least one negotiated peer": keeps the ticker running so presence stays current. */
  setWatching(watching: boolean): void {
    this.watching = watching;
    this.schedule();
  }

  view(): ShareQueueView {
    const all = this.delivering ? [this.delivering, ...this.items] : this.items;
    return {
      agentWorking: this.agentWorking,
      delivering: this.delivering !== null,
      items: all.map((item) => ({
        id: item.id,
        login: item.author?.login ?? '',
        avatarUrl: item.author?.avatarUrl ?? '',
        source: item.source,
        text: item.text,
        enqueuedAt: new Date(item.enqueuedAt).toISOString(),
      })),
    };
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.items.length = 0;
  }

  private schedule(): void {
    if (this.closed || this.timer || this.ticking) return;
    if (this.items.length === 0 && this.phase === 'idle' && !this.watching) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.ticking = true;
      // A tick never rejects: a dependency that throws reads as idle or as an unknown delivery.
      void this.tick().catch(() => undefined).finally(() => {
        this.ticking = false;
        this.schedule();
      });
    }, QUEUE_TICK_MS);
  }

  private async tick(): Promise<void> {
    const activity = await Promise.resolve()
      .then(() => this.deps.activity())
      .catch(() => ({ working: false, lastMessageId: null }));
    if (this.closed) return;
    this.agentWorking = activity.working;
    this.emitStatus();
    const wasIdle = this.phase === 'idle';
    if (this.phase === 'awaiting-start') {
      const started = activity.working
        || activity.lastMessageId !== this.startMark.lastMessageId
        || this.deps.now() - this.startMark.at >= TURN_START_TIMEOUT_MS;
      if (started) this.phase = 'awaiting-end';
    }
    if (this.phase === 'awaiting-end' && !activity.working) this.phase = 'idle';
    if (wasIdle && !activity.working && this.items.length > 0) await this.deliverHead(activity.lastMessageId);
  }

  private async deliverHead(lastMessageId: string | null): Promise<void> {
    const head = this.items.shift();
    if (!head) return;
    this.delivering = head;
    this.deliveringRevoked = false;
    const undo = this.events.onDelivering(head);
    const answer = await Promise.resolve()
      .then(() => this.deps.deliver(head.text))
      .catch(() => null);
    if (this.closed) return;
    this.delivering = null;
    const status = answer?.status ?? 500;
    if (status >= 200 && status < 300) {
      this.phase = 'awaiting-start';
      this.startMark = { lastMessageId, at: this.deps.now() };
      this.events.onOutcome(head, 'sent');
    } else if (status === 409 && this.deliveringRevoked) {
      undo();
      this.events.onOutcome(head, 'grant_revoked');
    } else if (status === 409) {
      undo();
      this.items.unshift(head);
    } else {
      undo();
      this.events.onOutcome(head, status >= 400 && status < 500 ? 'delivery_refused' : 'delivery_unknown');
    }
    this.emitStatus();
  }

  private emitStatus(): void {
    const next = { agentWorking: this.agentWorking, queued: this.items.length };
    if (next.agentWorking === this.status.agentWorking && next.queued === this.status.queued) return;
    this.status = next;
    this.events.onStatus(next);
  }
}

export function productionSubmitQueueDeps(conversationName: string): SubmitQueueDeps {
  // The transcript path needs a database read; reuse it between 1 s ticks so a tick costs one stat.
  let cached: { file: string; at: number } | null = null;
  const sessionFile = async (): Promise<string | null> => {
    const now = Date.now();
    if (cached && now - cached.at < SESSION_FILE_CACHE_MS) return cached.file;
    const file = await resolveClaudeSessionFile(conversationName).catch(() => null);
    cached = file ? { file, at: now } : null;
    return file;
  };
  return {
    deliver: async (text) => decodeDoorResponse(await handleConversationMessage(conversationName, { message: text }, {
      resolveSessionFile,
      generateAiTitle: async () => {},
    })),
    activity: async () => {
      const file = await sessionFile();
      if (!file) return { working: false, lastMessageId: null };
      try {
        const summary = await summarizeConversationActivity(file, { harness: 'claude-code' });
        return { working: summary.isWorking, lastMessageId: summary.messages.at(-1)?.id ?? null };
      } catch {
        return { working: false, lastMessageId: null };
      }
    },
    now: () => Date.now(),
  };
}
