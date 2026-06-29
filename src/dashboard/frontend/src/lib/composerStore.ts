/**
 * composerStore — per-conversation ephemeral composer state that must survive a
 * pane unmount.
 *
 * PAN-1591's side-by-side splits render only the *active* pane (Stage/index.tsx
 * renders `activePane` + an optional secondary; every other pane is unmounted,
 * not hidden). Switching conversations therefore destroys ComposerFooter and
 * ConversationView entirely. Anything those components kept in React
 * `useState` — the "Sending…" indicator, pasted images, the optimistic sent
 * message, and the failed-send retry outbox — was silently discarded on every
 * switch and recreated empty on return.
 *
 * Drafts already survive a switch because they live in `localStorage`. This
 * store is the in-memory equivalent for the state that *can't* be serialized:
 * blob preview URLs, `File` handles, and in-flight sends. It is module-level, so
 * it outlives any component, and keyed by conversation name (the same key drafts
 * use) so each conversation keeps its own state.
 *
 * Scope: in-memory survival across switches within a single page session. This
 * is deliberately NOT reload-durable — making pasted images survive a full
 * reload is tracked separately in #1592.
 *
 * Empty slices are pruned so the map only ever holds conversations that have
 * live ephemeral state.
 */
import { create } from 'zustand';
import type { ChatMessage, FailedMessage } from '../components/chat/chat-types';

export type { FailedMessage } from '../components/chat/chat-types';

export interface PendingImage {
  id: string;
  /**
   * The conversation this image was pasted/dropped into. Stamped at enqueue time
   * so async upload callbacks attribute the result to the right conversation even
   * if the user has since switched away.
   */
  conversationName: string;
  file: File;
  previewUrl: string;
  serverPath: string | null;
  error: string | null;
}

// ─── Per-conversation slice ────────────────────────────────────────────────────

interface ComposerSlice {
  /** A send (or model/harness switch) is in flight for this conversation. */
  sending: boolean;
  /** Pasted/dropped images awaiting (or finished) upload. */
  images: PendingImage[];
  /** Optimistically-rendered user message(s) shown before the server echoes them. */
  optimistic: ChatMessage[];
  /** Server message count captured when the optimistic message was added, so the
   *  view can tell when the real message has arrived and drop the optimistic copy. */
  optimisticBaseCount: number;
  /** Messages whose send POST failed — retryable from the timeline. */
  failed: FailedMessage[];
}

// Stable empty fallbacks so selectors return a referentially-stable value when a
// conversation has no slice (avoids re-render churn). Never mutated — consumers
// only read/map/filter/spread them.
const EMPTY_IMAGES: PendingImage[] = [];
const EMPTY_OPTIMISTIC: ChatMessage[] = [];
const EMPTY_FAILED: FailedMessage[] = [];

function emptySlice(): ComposerSlice {
  return { sending: false, images: [], optimistic: [], optimisticBaseCount: 0, failed: [] };
}

function isEmptySlice(s: ComposerSlice): boolean {
  return (
    !s.sending &&
    s.images.length === 0 &&
    s.optimistic.length === 0 &&
    s.failed.length === 0
  );
}

// ─── Message send (shared by the composer and the retry outbox) ─────────────────

/**
 * POST a message to a conversation (or agent) session. The single source of
 * truth for the send endpoint + payload, used by both the composer's first send
 * (ComposerFooter.handleSubmit) and the failed-message retry (retryFailed
 * below). Throws on a non-2xx response so callers can move the message to the
 * retry outbox.
 */
export async function sendConversationMessage(
  conversationName: string,
  message: string,
  agentId?: string,
  deliverAs?: 'steer' | 'follow_up',
): Promise<void> {
  const endpoint = agentId
    ? `/api/agents/${encodeURIComponent(agentId)}/message`
    : `/api/conversations/${encodeURIComponent(conversationName)}/message`;
  const payload = deliverAs && !agentId
    ? { message, deliverAs }
    : { message };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to send message (${res.status})${body ? `: ${body}` : ''}`);
  }
}

// ─── Image API + upload pump (module-level, survives component unmount) ─────────

async function uploadConversationImage(conversationName: string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('filename', file.name);
  formData.append('mimeType', file.type);

  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationName)}/upload-image`,
    { method: 'POST', body: formData },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to upload image (${res.status})${body ? `: ${body}` : ''}`);
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new Error('Image upload response was not valid JSON');
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('path' in payload) ||
    typeof payload.path !== 'string' ||
    payload.path.length === 0
  ) {
    throw new Error('Image upload response did not include a path');
  }
  return payload.path;
}

async function deleteConversationImage(conversationName: string, path: string): Promise<void> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationName)}/delete-image`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to delete image (${res.status})${body ? `: ${body}` : ''}`);
  }
}

export function revokePreviewUrl(previewUrl: string): void {
  if (typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(previewUrl);
  }
}

function deleteOrphanUpload(conversationName: string, path: string): void {
  void deleteConversationImage(conversationName, path).catch((err: unknown) => {
    console.error('[composerStore] Failed to delete image:', err);
  });
}

const MAX_CONCURRENT_UPLOADS = 3;
let activeUploads = 0;
const uploadQueue: PendingImage[] = [];
/** Ids of images removed while their upload was still in flight — their server
 *  upload must be deleted as an orphan once it completes. */
const removedImageIds = new Set<string>();

function pumpUploads(): void {
  while (activeUploads < MAX_CONCURRENT_UPLOADS && uploadQueue.length > 0) {
    const image = uploadQueue.shift()!;
    activeUploads++;
    void uploadConversationImage(image.conversationName, image.file).then(
      (serverPath) => {
        activeUploads--;
        try {
          if (removedImageIds.has(image.id)) {
            removedImageIds.delete(image.id);
            deleteOrphanUpload(image.conversationName, serverPath);
          } else {
            useComposerStore
              .getState()
              .updateImage(image.conversationName, image.id, { serverPath, error: null });
          }
        } finally {
          pumpUploads();
        }
      },
      (err: unknown) => {
        activeUploads--;
        try {
          if (removedImageIds.has(image.id)) {
            removedImageIds.delete(image.id);
            return;
          }
          const message = err instanceof Error ? err.message : 'Failed to upload image';
          useComposerStore.getState().updateImage(image.conversationName, image.id, { error: message });
        } finally {
          pumpUploads();
        }
      },
    );
  }
}

// ─── Store ──────────────────────────────────────────────────────────────────────

interface ComposerStore {
  byConversation: Record<string, ComposerSlice>;

  setSending(conversationName: string, value: boolean): void;

  enqueueImages(conversationName: string, files: File[]): void;
  /** Patch a single pending image (used by the upload pump). */
  updateImage(conversationName: string, id: string, patch: Partial<PendingImage>): void;
  /** Remove one image (the ✕ button): revokes its preview and deletes its server upload. */
  removeImage(conversationName: string, id: string): void;
  /** Drop all of a conversation's images after a successful send: revokes previews
   *  but does NOT delete the server uploads — the sent message references them. */
  consumeImages(conversationName: string): void;

  addOptimistic(conversationName: string, text: string, serverBaseCount: number): void;
  acknowledgeOptimistic(conversationName: string, text: string): void;
  clearOptimistic(conversationName: string): void;

  /** A send POST failed: drop the optimistic copy and add to the retry outbox. */
  failSend(conversationName: string, text: string): void;
  removeFailed(conversationName: string, id: string): void;

  /**
   * Re-send a message from the retry outbox. Mirrors the composer's first-send
   * path so a retry is exactly as robust as a first send: the text is moved from
   * the outbox to an optimistic "Sending…" bubble BEFORE the POST (so it is
   * always on a recoverable surface and the stall/compaction safety net in
   * ConversationView re-arms for it), then POSTed. On POST failure the message
   * returns to the outbox via failSend; a retry whose POST succeeds but is then
   * eaten by a compaction is caught by that same net instead of vanishing.
   */
  retryFailed(
    conversationName: string,
    failedId: string,
    text: string,
    serverBaseCount: number,
    agentId?: string,
  ): Promise<void>;
}

/** Immutably update one conversation's slice, pruning it when it becomes empty. */
function mutateSlice(
  byConversation: Record<string, ComposerSlice>,
  conversationName: string,
  fn: (slice: ComposerSlice) => ComposerSlice,
): Record<string, ComposerSlice> {
  const current = byConversation[conversationName] ?? emptySlice();
  const next = fn(current);
  const result = { ...byConversation };
  if (isEmptySlice(next)) {
    delete result[conversationName];
  } else {
    result[conversationName] = next;
  }
  return result;
}

export const useComposerStore = create<ComposerStore>((set, get) => ({
  byConversation: {},

  setSending: (conversationName, value) =>
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) =>
        s.sending === value ? s : { ...s, sending: value },
      ),
    })),

  enqueueImages: (conversationName, files) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const newImages = imageFiles.map(
      (file) =>
        ({
          id: crypto.randomUUID(),
          conversationName,
          file,
          previewUrl: URL.createObjectURL(file),
          serverPath: null,
          error: null,
        }) satisfies PendingImage,
    );
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        images: [...s.images, ...newImages],
      })),
    }));
    uploadQueue.push(...newImages);
    pumpUploads();
  },

  updateImage: (conversationName, id, patch) =>
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        images: s.images.map((image) => (image.id === id ? { ...image, ...patch } : image)),
      })),
    })),

  removeImage: (conversationName, id) => {
    const slice = get().byConversation[conversationName];
    const image = slice?.images.find((candidate) => candidate.id === id);
    if (image) {
      revokePreviewUrl(image.previewUrl);
      if (image.serverPath) {
        // Upload finished — delete the server copy directly.
        deleteOrphanUpload(conversationName, image.serverPath);
      } else {
        // Still uploading or queued. If it's still in the queue we can drop it
        // outright; if it's already in flight, mark it so the pump deletes the
        // orphan when the upload completes.
        const queueIdx = uploadQueue.findIndex((queued) => queued.id === id);
        if (queueIdx >= 0) uploadQueue.splice(queueIdx, 1);
        else removedImageIds.add(id);
      }
    }
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        images: s.images.filter((candidate) => candidate.id !== id),
      })),
    }));
  },

  consumeImages: (conversationName) => {
    const slice = get().byConversation[conversationName];
    if (!slice) return;
    for (const image of slice.images) {
      revokePreviewUrl(image.previewUrl);
    }
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        images: [],
      })),
    }));
  },

  addOptimistic: (conversationName, text, serverBaseCount) =>
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        // Only anchor the baseline when starting a fresh optimistic batch. A
        // second send while the first is still in flight must APPEND, not
        // replace — otherwise the first "Sending…" bubble vanishes (PAN-1591).
        optimisticBaseCount: s.optimistic.length === 0 ? serverBaseCount : s.optimisticBaseCount,
        optimistic: [
          ...s.optimistic,
          {
            id: `optimistic-${Date.now()}-${s.optimistic.length}`,
            role: 'user',
            text,
            createdAt: new Date().toISOString(),
          },
        ],
      })),
    })),

  acknowledgeOptimistic: (conversationName, text) =>
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => {
        let acknowledged = false;
        return {
          ...s,
          optimistic: s.optimistic.map((message) => {
            if (acknowledged || message.acknowledged || message.text !== text) return message;
            acknowledged = true;
            return { ...message, acknowledged: true };
          }),
        };
      }),
    })),

  clearOptimistic: (conversationName) =>
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) =>
        s.optimistic.length === 0 ? s : { ...s, optimistic: [], optimisticBaseCount: 0 },
      ),
    })),

  failSend: (conversationName, text) =>
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        optimistic: [],
        optimisticBaseCount: 0,
        failed: [
          ...s.failed,
          { id: `failed-${Date.now()}`, text, createdAt: new Date().toISOString() },
        ],
      })),
    })),

  removeFailed: (conversationName, id) =>
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        failed: s.failed.filter((failed) => failed.id !== id),
      })),
    })),

  retryFailed: async (conversationName, failedId, text, serverBaseCount, agentId) => {
    const { addOptimistic, removeFailed, failSend } = get();
    // Move the text onto a recoverable surface (an optimistic "Sending…" bubble)
    // BEFORE clearing the outbox entry and BEFORE the POST — the message is never
    // outbox → void. The optimistic bubble also re-arms the stall/compaction
    // safety net in ConversationView, so a retry the agent eats during a
    // compaction re-fails back to the outbox instead of being lost silently.
    addOptimistic(conversationName, text, serverBaseCount);
    removeFailed(conversationName, failedId);
    try {
      await sendConversationMessage(conversationName, text, agentId);
    } catch {
      // failSend clears the optimistic copy and re-adds the text to the outbox —
      // identical to the first-send failure path (ComposerFooter onSendFailed).
      failSend(conversationName, text);
    }
  },
}));

// ─── Selectors ──────────────────────────────────────────────────────────────────

export function useConversationSending(conversationName: string): boolean {
  return useComposerStore((s) => s.byConversation[conversationName]?.sending ?? false);
}

export function useConversationImages(conversationName: string): PendingImage[] {
  return useComposerStore((s) => s.byConversation[conversationName]?.images ?? EMPTY_IMAGES);
}

export function useConversationOptimistic(conversationName: string): ChatMessage[] {
  return useComposerStore((s) => s.byConversation[conversationName]?.optimistic ?? EMPTY_OPTIMISTIC);
}

export function useConversationOptimisticBaseCount(conversationName: string): number {
  return useComposerStore((s) => s.byConversation[conversationName]?.optimisticBaseCount ?? 0);
}

export function useConversationFailed(conversationName: string): FailedMessage[] {
  return useComposerStore((s) => s.byConversation[conversationName]?.failed ?? EMPTY_FAILED);
}

/** Non-hook synchronous read of a conversation's pending images (for event handlers). */
export function getConversationImages(conversationName: string): PendingImage[] {
  return useComposerStore.getState().byConversation[conversationName]?.images ?? EMPTY_IMAGES;
}

/**
 * Test-only: reset all module-level composer state (the store map AND the
 * upload pump's queue/in-flight counters/removed-id set) between cases. The
 * store is a process singleton, so without this state bleeds across tests.
 */
export function resetComposerStore(): void {
  uploadQueue.length = 0;
  activeUploads = 0;
  removedImageIds.clear();
  useComposerStore.setState({ byConversation: {} });
}
