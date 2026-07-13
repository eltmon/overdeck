import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { useComposerStore, resetComposerStore } from '../composerStore';

const CONV = 'conv-test';

/** Minimal fetch Response stub for the message-send POST. */
function fetchResult(ok: boolean, status = ok ? 200 : 500, body = ''): Response {
  return { ok, status, text: async () => body } as unknown as Response;
}

describe('composerStore optimistic messages', () => {
  beforeEach(() => {
    resetComposerStore();
  });

  it('keeps the first optimistic message when a second is sent before the server echoes (PAN-1591)', () => {
    const { addOptimistic } = useComposerStore.getState();

    // First send: server currently has 4 messages.
    addOptimistic(CONV, 'first message', 4);
    let slice = useComposerStore.getState().byConversation[CONV];
    expect(slice.optimistic.map((m) => m.text)).toEqual(['first message']);
    expect(slice.optimisticBaseCount).toBe(4);

    // Second send before the first is echoed — must APPEND, not replace, and the
    // baseline must stay anchored at the original 4.
    addOptimistic(CONV, 'second message', 4);
    slice = useComposerStore.getState().byConversation[CONV];
    expect(slice.optimistic.map((m) => m.text)).toEqual(['first message', 'second message']);
    expect(slice.optimisticBaseCount).toBe(4);
  });

  it('anchors a fresh baseline after the previous batch is cleared', () => {
    const { addOptimistic, clearOptimistic } = useComposerStore.getState();

    addOptimistic(CONV, 'first', 2);
    clearOptimistic(CONV);
    expect(useComposerStore.getState().byConversation[CONV]).toBeUndefined();

    // A new batch re-anchors at the current server count.
    addOptimistic(CONV, 'second', 7);
    const slice = useComposerStore.getState().byConversation[CONV];
    expect(slice.optimistic.map((m) => m.text)).toEqual(['second']);
    expect(slice.optimisticBaseCount).toBe(7);
  });
});

describe('composerStore retryFailed — a retry never loses the text', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetComposerStore();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Seed one failed-outbox entry and return its generated id. */
  function seedFailed(text: string): string {
    useComposerStore.getState().failSend(CONV, text);
    const failed = useComposerStore.getState().byConversation[CONV]?.failed ?? [];
    return failed[failed.length - 1]!.id;
  }

  it('moves the text to an optimistic bubble and clears the outbox (text stays on a recoverable surface)', async () => {
    fetchMock.mockResolvedValue(fetchResult(true));
    const id = seedFailed('hello');

    // Server currently has 3 messages — the optimistic baseline must anchor there.
    await useComposerStore.getState().retryFailed(CONV, id, 'hello', 3);

    const slice = useComposerStore.getState().byConversation[CONV];
    // Outbox cleared, text now tracked as optimistic so the stall/compaction net
    // in ConversationView can recover it if the agent eats it during a compaction.
    expect(slice.failed).toEqual([]);
    expect(slice.optimistic.map((m) => m.text)).toEqual(['hello']);
    expect(slice.optimisticBaseCount).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/conversations/${CONV}/message`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: 'hello' }) }),
    );
  });

  it('returns the message to the outbox if the POST fails (no data loss)', async () => {
    fetchMock.mockResolvedValue(fetchResult(false, 500, 'boom'));
    const id = seedFailed('hello');

    await useComposerStore.getState().retryFailed(CONV, id, 'hello', 3);

    const slice = useComposerStore.getState().byConversation[CONV];
    // The optimistic copy is dropped and the text is back in the outbox, retryable.
    expect(slice.optimistic).toEqual([]);
    expect(slice.failed.map((f) => f.text)).toEqual(['hello']);
  });

  it('returns the message to the outbox if fetch itself rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const id = seedFailed('hello');

    await useComposerStore.getState().retryFailed(CONV, id, 'hello', 0);

    const slice = useComposerStore.getState().byConversation[CONV];
    expect(slice.optimistic).toEqual([]);
    expect(slice.failed.map((f) => f.text)).toEqual(['hello']);
  });

  it('targets the agent endpoint when an agentId is supplied', async () => {
    fetchMock.mockResolvedValue(fetchResult(true));
    const id = seedFailed('hello');

    await useComposerStore.getState().retryFailed(CONV, id, 'hello', 0, 'agent-pan-42');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/agent-pan-42/message',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('composerStore attachments', () => {
  beforeEach(() => {
    resetComposerStore();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:preview-url'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('attachment-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('classifies images with a preview URL', () => {
    const file = new File(['png-bytes'], 'paste.png', { type: 'image/png' });
    const { rejected } = useComposerStore.getState().enqueueAttachments(CONV, [file]);

    expect(rejected).toEqual([]);
    const attachments = useComposerStore.getState().byConversation[CONV]?.attachments ?? [];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      kind: 'image',
      file,
      previewUrl: 'blob:preview-url',
      serverPath: null,
      error: null,
    });
  });

  it('classifies text/code files without a preview URL', () => {
    const file = new File(['console.log("hi")'], 'script.ts', { type: '' });
    const { rejected } = useComposerStore.getState().enqueueAttachments(CONV, [file]);

    expect(rejected).toEqual([]);
    const attachments = useComposerStore.getState().byConversation[CONV]?.attachments ?? [];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      kind: 'file',
      file,
      previewUrl: null,
      serverPath: null,
      error: null,
    });
  });

  it('rejects files with unsupported extensions', () => {
    const image = new File(['png-bytes'], 'ok.png', { type: 'image/png' });
    const bad = new File(['binary'], 'app.exe', { type: 'application/octet-stream' });
    const { rejected } = useComposerStore.getState().enqueueAttachments(CONV, [image, bad]);

    expect(rejected).toEqual([bad]);
    const attachments = useComposerStore.getState().byConversation[CONV]?.attachments ?? [];
    expect(attachments).toHaveLength(1);
    expect(attachments[0].file.name).toBe('ok.png');
  });

  it('infers a MIME type for files the browser reports as empty', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ path: '/tmp/script.ts' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const file = new File(['const x = 1;'], 'script.ts', { type: '' });
    useComposerStore.getState().enqueueAttachments(CONV, [file]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/conversations/${CONV}/upload-image`,
        expect.objectContaining({
          method: 'POST',
          body: expect.any(FormData),
        }),
      );
    });

    const formData = fetchMock.mock.calls[0]![1]!.body as FormData;
    expect(formData.get('mimeType')).toBe('text/typescript');
  });
});
