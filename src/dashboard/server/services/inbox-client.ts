/**
 * Delivers the webhook events the overdeck.ai directory inbox held for this machine (PRD PAN-2356
 * WI-19, D-2356-17). Events are handled one at a time in arrival order (the directory sends every
 * pending event, oldest first, on each welcome); each one ends in `inbox-ack` or
 * `inbox-nack { retryAfterSeconds }`.
 */
import type { DirectoryToMachineFrame, MachineToDirectoryFrame } from '@overdeck/contracts';

import { handleInboxEvent, type InboxHandlerDeps } from '../../../lib/triggers/inbox.js';

export interface InboxDirectory {
  send(frame: MachineToDirectoryFrame): boolean;
  on<T extends DirectoryToMachineFrame['type']>(type: T, handler: (frame: Extract<DirectoryToMachineFrame, { type: T }>) => void): () => void;
}

export class InboxClient {
  private queue: Promise<void> = Promise.resolve();
  private off: (() => void) | null = null;

  constructor(
    private readonly directory: InboxDirectory,
    private readonly deps: InboxHandlerDeps,
  ) {}

  start(): void {
    this.off = this.directory.on('inbox-event', (frame) => {
      this.queue = this.queue.then(() => this.handle(frame));
    });
  }

  stop(): void {
    this.off?.();
    this.off = null;
  }

  /** Settles when every queued event has been answered (tests). */
  idle(): Promise<void> {
    return this.queue;
  }

  private async handle(frame: Extract<DirectoryToMachineFrame, { type: 'inbox-event' }>): Promise<void> {
    let answer;
    try {
      answer = await handleInboxEvent(frame, this.deps);
    } catch (error) {
      // A local failure (trigger store unreadable, door threw): let the directory retry later.
      console.warn(`[triggers] inbox ${frame.inboxId} delivery failed: ${(error as Error).message}`);
      answer = { kind: 'nack' as const, retryAfterSeconds: 300 };
    }
    if (answer.kind === 'ack') this.directory.send({ type: 'inbox-ack', eventId: frame.eventId });
    else this.directory.send({ type: 'inbox-nack', eventId: frame.eventId, retryAfterSeconds: answer.retryAfterSeconds });
  }
}
