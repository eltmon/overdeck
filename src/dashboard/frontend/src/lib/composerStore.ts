/**
 * composerStore — per-conversation ephemeral composer state that must survive a
 * pane unmount.
 *
 * PAN-1591's side-by-side splits render only the *active* pane (Stage/index.tsx
 * renders `activePane` + an optional secondary; every other pane is unmounted,
 * not hidden). Switching conversations therefore destroys ComposerFooter and
 * ConversationView entirely. Anything those components kept in React
 * `useState` — the "Sending…" indicator, pasted attachments, the optimistic sent
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
 * is deliberately NOT reload-durable — making pasted attachments survive a full
 * reload is tracked separately in #1592.
 *
 * Empty slices are pruned so the map only ever holds conversations that have
 * live ephemeral state.
 */
import type { ComposerCommandResult } from '@overdeck/contracts';
import { create } from 'zustand';
import type { ChatMessage, FailedMessage } from '../components/chat/chat-types';
import {
  ATTACHMENT_ACCEPT,
  classifyAttachmentKind,
  inferAttachmentMime,
  type AttachmentKind,
} from './attachmentTypes';

export type { FailedMessage } from '../components/chat/chat-types';

export interface PendingAttachment {
  id: string;
  /**
   * The conversation this attachment was pasted/dropped/selected into. Stamped at
   * enqueue time so async upload callbacks attribute the result to the right
   * conversation even if the user has since switched away.
   */
  conversationName: string;
  kind: AttachmentKind;
  file: File;
  /** Object URL for image previews; `null` for non-image file attachments. */
  previewUrl: string | null;
  serverPath: string | null;
  error: string | null;
}

// ─── Per-conversation slice ────────────────────────────────────────────────────

interface ComposerSlice {
  /** A send (or model/harness switch) is in flight for this conversation. */
  sending: boolean;
  /** Pending images/files awaiting (or finished) upload. */
  attachments: PendingAttachment[];
  /** Optimistically-rendered user message(s) shown before the server echoes them. */
  optimistic: ChatMessage[];
  /** Server message count captured when the optimistic message was added, so the
   *  view can tell when the real message has arrived and drop the optimistic copy. */
  optimisticBaseCount: number;
  /** Messages whose send POST failed — retryable from the timeline. */
  failed: FailedMessage[];
  /** Structured results from dashboard-intercepted `/pan` commands. */
  commandResults: ChatMessage[];
}

// Stable empty fallbacks so selectors return a referentially-stable value when a
// conversation has no slice (avoids re-render churn). Never mutated — consumers
// only read/map/filter/spread them.
const EMPTY_ATTACHMENTS: PendingAttachment[] = [];
const EMPTY_OPTIMISTIC: ChatMessage[] = [];
const EMPTY_FAILED: FailedMessage[] = [];
const EMPTY_COMMAND_RESULTS: ChatMessage[] = [];

function emptySlice(): ComposerSlice {
  return {
    sending: false,
    attachments: [],
    optimistic: [],
    optimisticBaseCount: 0,
    failed: [],
    commandResults: [],
  };
}

function isEmptySlice(s: ComposerSlice): boolean {
  return (
    !s.sending &&
    s.attachments.length === 0 &&
    s.optimistic.length === 0 &&
    s.failed.length === 0 &&
    s.commandResults.length === 0
  );
}

// ─── Message send (shared by the composer and the retry outbox) ─────────────────

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
  constructor(message: string, opts: { status?: number; reason?: string }) {
    super(message);
    this.name = 'MessageSendError';
    this.status = opts.status;
    this.reason = opts.reason;
    this.retryable = opts.status === undefined
      || opts.status >= 500
      || opts.status === 408
      || opts.status === 429;
  }
}

export interface SendFailureDetails {
  error?: string;
  retryable?: boolean;
}

/** Extract the display reason + retryability the outbox preserves from any send failure. */
export function sendFailureDetails(err: unknown): SendFailureDetails {
  if (err instanceof MessageSendError) {
    return { error: err.reason ?? err.message, retryable: err.retryable };
  }
  return { error: err instanceof Error ? err.message : String(err), retryable: true };
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
): Promise<ComposerCommandResult | null> {
  const endpoint = agentId
    ? `/api/agents/${encodeURIComponent(agentId)}/message`
    : `/api/conversations/${encodeURIComponent(conversationName)}/message`;
  const payload = {
    message,
    ...(deliverAs && !agentId ? { deliverAs } : {}),
    ...(confirmation ? {
      confirmationNonce: confirmation.nonce,
      ...(confirmation.typedText !== undefined
        ? { confirmationText: confirmation.typedText }
        : {}),
    } : {}),
  };
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Network-level failure (server unreachable, connection reset): no status,
    // always retryable.
    throw new MessageSendError(
      `Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
      {},
    );
  }
  const body = await res.text().catch(() => '');
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
    throw new MessageSendError(
      `Failed to send message (${res.status})${error ? `: ${error}` : ''}`,
      { status: res.status, reason: error || undefined },
    );
  }
  return null;
}

// ─── Attachment API + upload pump (module-level, survives component unmount) ────

async function uploadConversationAttachment(conversationName: string, file: File, kind: AttachmentKind): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('filename', file.name);
  formData.append('mimeType', kind === 'image' && file.type ? file.type : inferAttachmentMime(file));

  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationName)}/upload-image`,
    { method: 'POST', body: formData },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to upload attachment (${res.status})${body ? `: ${body}` : ''}`);
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new Error('Attachment upload response was not valid JSON');
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('path' in payload) ||
    typeof payload.path !== 'string' ||
    payload.path.length === 0
  ) {
    throw new Error('Attachment upload response did not include a path');
  }
  return payload.path;
}

async function deleteConversationAttachment(conversationName: string, path: string): Promise<void> {
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
    throw new Error(`Failed to delete attachment (${res.status})${body ? `: ${body}` : ''}`);
  }
}

export function revokePreviewUrl(previewUrl: string | null): void {
  if (previewUrl && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(previewUrl);
  }
}

function deleteOrphanUpload(conversationName: string, path: string): void {
  void deleteConversationAttachment(conversationName, path).catch((err: unknown) => {
    console.error('[composerStore] Failed to delete attachment:', err);
  });
}

const MAX_CONCURRENT_UPLOADS = 3;
let activeUploads = 0;
const uploadQueue: PendingAttachment[] = [];
/** Ids of attachments removed while their upload was still in flight — their server
 *  upload must be deleted as an orphan once it completes. */
const removedAttachmentIds = new Set<string>();

function pumpUploads(): void {
  while (activeUploads < MAX_CONCURRENT_UPLOADS && uploadQueue.length > 0) {
    const attachment = uploadQueue.shift()!;
    activeUploads++;
    void uploadConversationAttachment(attachment.conversationName, attachment.file, attachment.kind).then(
      (serverPath) => {
        activeUploads--;
        try {
          if (removedAttachmentIds.has(attachment.id)) {
            removedAttachmentIds.delete(attachment.id);
            deleteOrphanUpload(attachment.conversationName, serverPath);
          } else {
            useComposerStore
              .getState()
              .updateAttachment(attachment.conversationName, attachment.id, { serverPath, error: null });
          }
        } finally {
          pumpUploads();
        }
      },
      (err: unknown) => {
        activeUploads--;
        try {
          if (removedAttachmentIds.has(attachment.id)) {
            removedAttachmentIds.delete(attachment.id);
            return;
          }
          const message = err instanceof Error ? err.message : 'Failed to upload attachment';
          useComposerStore.getState().updateAttachment(attachment.conversationName, attachment.id, { error: message });
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

  /**
   * Enqueue allowed files for upload. Rejected files are returned so the UI can
   * surface a "N files not supported" hint. Files are classified by MIME type and
   * extension against the server allowlist; any unsupported file is rejected.
   */
  enqueueAttachments(conversationName: string, files: File[]): { rejected: File[] };
  /** Patch a single pending attachment (used by the upload pump). */
  updateAttachment(conversationName: string, id: string, patch: Partial<PendingAttachment>): void;
  /** Remove one attachment (the ✕ button): revokes its preview and deletes its server upload. */
  removeAttachment(conversationName: string, id: string): void;
  /** Drop all of a conversation's attachments after a successful send: revokes previews
   *  but does NOT delete the server uploads — the sent message references them. */
  consumeAttachments(conversationName: string): void;

  addOptimistic(conversationName: string, text: string, serverBaseCount: number): void;
  acknowledgeOptimistic(conversationName: string, text: string): void;
  clearOptimistic(conversationName: string): void;

  /** A send POST failed: preserve it in the retry outbox with its original lane. */
  failSend(conversationName: string, text: string, kind?: FailedMessage['kind'], details?: SendFailureDetails): void;
  removeFailed(conversationName: string, id: string): void;

  addCommandResult(
    conversationName: string,
    commandText: string,
    result: ComposerCommandResult,
  ): void;
  replaceCommandResult(
    conversationName: string,
    messageId: string,
    result: ComposerCommandResult,
  ): void;
  removeCommandResult(conversationName: string, messageId: string): void;

  /**
   * Re-send a message from the retry outbox through its original lane. Prompts
   * retain the existing optimistic-bubble and compaction recovery behavior.
   * Commands never become prompt bubbles; their structured result is appended
   * to the command timeline instead.
   */
  retryFailed(
    conversationName: string,
    failedId: string,
    text: string,
    serverBaseCount: number,
    agentId?: string,
  ): Promise<ComposerCommandResult | null>;
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

  enqueueAttachments: (conversationName, files) => {
    const accepted: PendingAttachment[] = [];
    const rejected: File[] = [];
    for (const file of files) {
      const kind = classifyAttachmentKind(file);
      if (!kind) {
        rejected.push(file);
        continue;
      }
      accepted.push({
        id: crypto.randomUUID(),
        conversationName,
        kind,
        file,
        previewUrl: kind === 'image' ? URL.createObjectURL(file) : null,
        serverPath: null,
        error: null,
      });
    }
    if (accepted.length === 0) return { rejected };
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        attachments: [...s.attachments, ...accepted],
      })),
    }));
    uploadQueue.push(...accepted);
    pumpUploads();
    return { rejected };
  },

  updateAttachment: (conversationName, id, patch) =>
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        attachments: s.attachments.map((attachment) => (attachment.id === id ? { ...attachment, ...patch } : attachment)),
      })),
    })),

  removeAttachment: (conversationName, id) => {
    const slice = get().byConversation[conversationName];
    const attachment = slice?.attachments.find((candidate) => candidate.id === id);
    if (attachment) {
      revokePreviewUrl(attachment.previewUrl);
      if (attachment.serverPath) {
        // Upload finished — delete the server copy directly.
        deleteOrphanUpload(conversationName, attachment.serverPath);
      } else {
        // Still uploading or queued. If it's still in the queue we can drop it
        // outright; if it's already in flight, mark it so the pump deletes the
        // orphan when the upload completes.
        const queueIdx = uploadQueue.findIndex((queued) => queued.id === id);
        if (queueIdx >= 0) uploadQueue.splice(queueIdx, 1);
        else removedAttachmentIds.add(id);
      }
    }
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        attachments: s.attachments.filter((candidate) => candidate.id !== id),
      })),
    }));
  },

  consumeAttachments: (conversationName) => {
    const slice = get().byConversation[conversationName];
    if (!slice) return;
    for (const attachment of slice.attachments) {
      revokePreviewUrl(attachment.previewUrl);
    }
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        attachments: [],
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

  failSend: (conversationName, text, kind = 'prompt', details) =>
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        optimistic: kind === 'prompt' ? [] : s.optimistic,
        optimisticBaseCount: kind === 'prompt' ? 0 : s.optimisticBaseCount,
        failed: [
          ...s.failed,
          {
            id: `failed-${Date.now()}`,
            text,
            kind,
            createdAt: new Date().toISOString(),
            ...(details?.error !== undefined ? { error: details.error } : {}),
            ...(details?.retryable !== undefined ? { retryable: details.retryable } : {}),
          },
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

  addCommandResult: (conversationName, commandText, result) =>
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        commandResults: [
          ...s.commandResults,
          {
            id: `command-result-${Date.now()}-${s.commandResults.length}`,
            role: 'system',
            text: commandText,
            commandText,
            commandResult: result,
            createdAt: new Date().toISOString(),
          },
        ],
      })),
    })),

  replaceCommandResult: (conversationName, messageId, result) =>
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        commandResults: s.commandResults.map((message) =>
          message.id === messageId ? { ...message, commandResult: result } : message,
        ),
      })),
    })),

  removeCommandResult: (conversationName, messageId) =>
    set((state) => ({
      byConversation: mutateSlice(state.byConversation, conversationName, (s) => ({
        ...s,
        commandResults: s.commandResults.filter((message) => message.id !== messageId),
      })),
    })),

  retryFailed: async (conversationName, failedId, text, serverBaseCount, agentId) => {
    const { addOptimistic, addCommandResult, removeFailed, failSend } = get();
    const failed = get().byConversation[conversationName]?.failed.find(
      candidate => candidate.id === failedId,
    );
    const kind = failed?.kind ?? 'prompt';
    if (kind === 'prompt') {
      // Preserve the ordinary prompt path byte-for-byte: move the text onto a
      // recoverable optimistic surface before clearing the outbox and POSTing.
      addOptimistic(conversationName, text, serverBaseCount);
    }
    removeFailed(conversationName, failedId);
    try {
      const result = await sendConversationMessage(conversationName, text, agentId);
      if (kind === 'command' && result && result.kind !== 'ui') {
        addCommandResult(conversationName, text, result);
      }
      return result;
    } catch (err) {
      failSend(conversationName, text, kind, sendFailureDetails(err));
      return null;
    }
  },
}));

// ─── Selectors ──────────────────────────────────────────────────────────────────

export function useConversationSending(conversationName: string): boolean {
  return useComposerStore((s) => s.byConversation[conversationName]?.sending ?? false);
}

export function useConversationAttachments(conversationName: string): PendingAttachment[] {
  return useComposerStore((s) => s.byConversation[conversationName]?.attachments ?? EMPTY_ATTACHMENTS);
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

export function useConversationCommandResults(conversationName: string): ChatMessage[] {
  return useComposerStore(
    (s) => s.byConversation[conversationName]?.commandResults ?? EMPTY_COMMAND_RESULTS,
  );
}

/** Non-hook synchronous read of a conversation's pending attachments (for event handlers). */
export function getConversationAttachments(conversationName: string): PendingAttachment[] {
  return useComposerStore.getState().byConversation[conversationName]?.attachments ?? EMPTY_ATTACHMENTS;
}

/** The `accept` attribute value for the composer's hidden file input. */
export function getAttachmentAccept(): string {
  return ATTACHMENT_ACCEPT;
}

/**
 * Test-only: reset all module-level composer state (the store map AND the
 * upload pump's queue/in-flight counters/removed-id set) between cases. The
 * store is a process singleton, so without this state bleeds across tests.
 */
export function resetComposerStore(): void {
  uploadQueue.length = 0;
  activeUploads = 0;
  removedAttachmentIds.clear();
  useComposerStore.setState({ byConversation: {} });
}
