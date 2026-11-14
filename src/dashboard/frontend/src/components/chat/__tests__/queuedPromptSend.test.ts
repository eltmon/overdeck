import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetComposerStore, useComposerStore } from '../../../lib/composerStore';
import { enqueueConversationSend } from '../../../lib/composerSendQueue';
import { deliverQueuedPrompt } from '../queuedPromptSend';

const { mockToastError, mockToastWarning } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockToastWarning: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    warning: (...args: unknown[]) => mockToastWarning(...args),
    success: vi.fn(),
  },
}));

const CONV = 'queued-prompt-conv';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('deliverQueuedPrompt', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let onAcknowledged: ReturnType<typeof vi.fn>;
  let onFailed: ReturnType<typeof vi.fn>;
  let onOpenUi: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetComposerStore();
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    onAcknowledged = vi.fn();
    onFailed = vi.fn();
    onOpenUi = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('acknowledges on a 200 with an empty body', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));

    await deliverQueuedPrompt({
      conversationName: CONV,
      message: 'hello',
      clientMessageId: 'client-1',
      onAcknowledged,
      onFailed,
      onOpenUi,
    });

    expect(onAcknowledged).toHaveBeenCalledWith('hello', 'client-1');
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('holds on 409 permission-pending without calling onFailed', async () => {
    useComposerStore.getState().addOptimistic(CONV, 'hello', 0, { clientMessageId: 'client-1' });
    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'permission pending', code: 'permission-pending' }));

    await deliverQueuedPrompt({
      conversationName: CONV,
      message: 'hello',
      clientMessageId: 'client-1',
      onAcknowledged,
      onFailed,
      onOpenUi,
    });

    expect(onFailed).not.toHaveBeenCalled();
    const bubble = useComposerStore.getState().byConversation[CONV]?.optimistic
      .find((m) => m.clientMessageId === 'client-1');
    expect(bubble?.deliveryState).toBe('held');
  });

  it('reports a 500 through onFailed with the clientMessageId', async () => {
    fetchMock.mockResolvedValue(new Response('server error', { status: 500 }));

    await deliverQueuedPrompt({
      conversationName: CONV,
      message: 'hello',
      clientMessageId: 'client-1',
      onAcknowledged,
      onFailed,
      onOpenUi,
    });

    expect(onFailed).toHaveBeenCalledWith('hello', 'prompt', expect.objectContaining({ clientMessageId: 'client-1' }));
    expect(mockToastError).toHaveBeenCalled();
  });

  it('holds without a POST when an earlier bubble is held', async () => {
    const { addOptimistic, hold } = useComposerStore.getState();
    addOptimistic(CONV, 'first', 0, { clientMessageId: 'client-a' });
    hold(CONV, 'client-a');
    addOptimistic(CONV, 'second', 0, { clientMessageId: 'client-b' });

    await deliverQueuedPrompt({
      conversationName: CONV,
      message: 'second',
      clientMessageId: 'client-b',
      onAcknowledged,
      onFailed,
      onOpenUi,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    const bubbleB = useComposerStore.getState().byConversation[CONV]?.optimistic
      .find((m) => m.clientMessageId === 'client-b');
    expect(bubbleB?.deliveryState).toBe('held');
  });
  describe('cancel (PAN-5237)', () => {
    function prompt(message: string, clientMessageId: string) {
      useComposerStore.getState().addOptimistic(CONV, message, 0, { clientMessageId, sendPhase: 'queued' });
      return enqueueConversationSend(CONV, () => deliverQueuedPrompt({
        conversationName: CONV, message, clientMessageId, onAcknowledged, onFailed, onOpenUi,
      }));
    }
    const bubbleId = (clientMessageId: string) => useComposerStore.getState().byConversation[CONV]!.optimistic
      .find((m) => m.clientMessageId === clientMessageId)!.id;
    const postedMessages = () => fetchMock.mock.calls.map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { message: string }).message);

    it('a cancelled queued message is never posted and later messages still go out in order', async () => {
      let releaseFirst!: (response: Response) => void;
      fetchMock
        .mockImplementationOnce(() => new Promise<Response>((resolve) => { releaseFirst = resolve; }))
        .mockResolvedValue(new Response('', { status: 200 }));
      const first = prompt('first', 'client-1');
      const second = prompt('second', 'client-2');
      const third = prompt('third', 'client-3');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await useComposerStore.getState().cancelSend(bubbleId('client-2'));
      releaseFirst(new Response('', { status: 200 }));
      await Promise.all([first, second, third]);
      expect(postedMessages()).toEqual(['first', 'third']);
      expect(onAcknowledged.mock.calls.map(([text]) => text)).toEqual(['first', 'third']);
    });

    it('a cancelled queued prompt calls neither fetch, onFailed, onAcknowledged nor toast.error', async () => {
      let releaseBlocker!: () => void;
      const blocker = enqueueConversationSend(CONV, () => new Promise<void>((resolve) => { releaseBlocker = resolve; }));
      const queued = prompt('cancel me', 'client-1');
      await useComposerStore.getState().cancelSend(bubbleId('client-1'));
      releaseBlocker();
      await Promise.all([blocker, queued]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onFailed).not.toHaveBeenCalled();
      expect(onAcknowledged).not.toHaveBeenCalled();
      expect(mockToastError).not.toHaveBeenCalled();
    });

    it('an in-flight prompt answered 409 code cancelled calls neither onFailed nor toast.error', async () => {
      fetchMock.mockResolvedValue(jsonResponse(409, {
        error: 'Cancelled before delivery', code: 'cancelled', deliveryUnknown: false, retryable: false,
      }));
      await prompt('late', 'client-1');
      expect(onFailed).not.toHaveBeenCalled();
      expect(mockToastError).not.toHaveBeenCalled();
      const slice = useComposerStore.getState().byConversation[CONV];
      expect(slice?.optimistic ?? []).toEqual([]);
      expect(slice?.failed).toEqual([expect.objectContaining({ code: 'cancelled', text: 'late' })]);
    });
  });
});
