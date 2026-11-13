// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: src/renderer/src/components/editor/save/queue/editor-save-queue.ts @ 73771e67d01
// upstream: src/renderer/src/components/editor/save/queue/editor-save-slots.ts @ 73771e67d01
/**
 * Code pane save queue (PAN-5187, FR-7, FR-8).
 *
 * One write in flight per file key. A request enqueued while a write is in
 * flight waits; a later request joins the waiting one, which then carries
 * the newest text and the strongest intent of the two (Overwrite beats an
 * explicit save, which beats autosave), as Orca's save slots rank triggers.
 *
 * The expected signature is read when a write starts, not when it is
 * enqueued, so a queued save carries the signature the previous save
 * returned. An Overwrite sends null. A failed write drops the queued
 * request for its key and reports the error.
 *
 * Orca's queue also coordinates its multi-view buffers, transforms and
 * file-operation locks; Overdeck has one pane per file, so only the slot
 * logic is ported.
 */

export interface SaveRequest {
  text: string;
  /** Create the file if it is missing (explicit saves). */
  allowMissing: boolean;
  /** Write without a precondition (the banner's Overwrite). */
  overwrite?: boolean;
}

export interface SaveWrite {
  text: string;
  expectedSignature: string | null;
  allowMissing: boolean;
}

export interface SaveQueueDeps {
  write(key: string, req: SaveWrite): Promise<{ signature: string }>;
  getBaseSignature(key: string): string | null;
  onSaved(key: string, text: string, signature: string): void;
  onError(key: string, error: unknown): void;
}

export interface SaveQueue {
  enqueue(key: string, req: SaveRequest): void;
  isInFlight(key: string): boolean;
  /** Resolves when nothing is in flight or queued for the key. */
  whenIdle(key: string): Promise<void>;
}

interface Slot {
  queued: SaveRequest | null;
  idle: Promise<void>;
}

function join(queued: SaveRequest, incoming: SaveRequest): SaveRequest {
  return {
    text: incoming.text,
    allowMissing: queued.allowMissing || incoming.allowMissing,
    overwrite: queued.overwrite === true || incoming.overwrite === true,
  };
}

export function createSaveQueue(deps: SaveQueueDeps): SaveQueue {
  const slots = new Map<string, Slot>();

  async function drain(key: string, slot: Slot, first: SaveRequest): Promise<void> {
    let request: SaveRequest | null = first;
    while (request) {
      const expectedSignature = request.overwrite ? null : deps.getBaseSignature(key);
      try {
        const { signature } = await deps.write(key, { text: request.text, expectedSignature, allowMissing: request.allowMissing });
        deps.onSaved(key, request.text, signature);
      } catch (error) {
        slot.queued = null;
        deps.onError(key, error);
      }
      request = slot.queued;
      slot.queued = null;
    }
    slots.delete(key);
  }

  return {
    enqueue(key, req) {
      const slot = slots.get(key);
      if (slot) {
        slot.queued = slot.queued ? join(slot.queued, req) : { ...req };
        return;
      }
      const created: Slot = { queued: null, idle: Promise.resolve() };
      slots.set(key, created);
      created.idle = drain(key, created, { ...req });
    },
    isInFlight: (key) => slots.has(key),
    whenIdle: (key) => slots.get(key)?.idle ?? Promise.resolve(),
  };
}
