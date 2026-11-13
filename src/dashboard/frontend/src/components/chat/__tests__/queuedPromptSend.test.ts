import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetComposerStore, useComposerStore } from '../../../lib/composerStore';
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
});
