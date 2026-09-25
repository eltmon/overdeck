import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver, type QueryKey } from '@tanstack/react-query';
import { BACKEND_RECONNECTED_EVENT } from './backendConnectionEvents';
import { installQueryRecovery, recoveryRetryDelayMs } from './queryRecovery';

// Mirrors main.tsx's global policy for the failures that matter here: an HTTP
// error is not a fetch TypeError, so the global predicate does not retry it.
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false, staleTime: 30_000 } },
  });
}

function observe<T>(client: QueryClient, queryKey: QueryKey, queryFn: () => Promise<T>) {
  const observer = new QueryObserver(client, { queryKey, queryFn });
  const unsubscribe = observer.subscribe(() => undefined);
  return { observer, unsubscribe };
}

describe('queryRecovery (PAN-3527)', () => {
  let client: QueryClient;
  let uninstall: () => void = () => undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    client = makeClient();
  });

  afterEach(() => {
    uninstall();
    client.clear();
    vi.useRealTimers();
  });

  it('backs off exponentially and caps the delay', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(recoveryRetryDelayMs)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });

  it('retries a failed project-list fetch with backoff until it succeeds', async () => {
    uninstall = installQueryRecovery(client);
    const queryFn = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch resource-allocated issues'))
      .mockRejectedValueOnce(new Error('Failed to fetch resource-allocated issues'))
      .mockResolvedValueOnce([{ name: 'overdeck' }]);
    const { observer, unsubscribe } = observe(client, ['command-deck-projects', 0], queryFn);

    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(1);
    // A failure keeps the query loading, not settled as an empty list.
    expect(observer.getCurrentResult().status).toBe('pending');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(queryFn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(queryFn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(queryFn).toHaveBeenCalledTimes(3);

    expect(observer.getCurrentResult().data).toEqual([{ name: 'overdeck' }]);
    unsubscribe();
  });

  it('applies the same retry policy to the conversation list and project registry', async () => {
    uninstall = installQueryRecovery(client);
    for (const queryKey of [['conversations'], ['registered-projects']]) {
      const queryFn = vi.fn()
        .mockRejectedValueOnce(new Error('HTTP 503'))
        .mockResolvedValueOnce(['ok']);
      const { observer, unsubscribe } = observe(client, queryKey, queryFn);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(queryFn).toHaveBeenCalledTimes(2);
      expect(observer.getCurrentResult().data).toEqual(['ok']);
      unsubscribe();
    }
  });

  it('settles as an error after the bounded retries so error states can render', async () => {
    uninstall = installQueryRecovery(client);
    const queryFn = vi.fn().mockRejectedValue(new Error('HTTP 500'));
    const { observer, unsubscribe } = observe(client, ['conversations'], queryFn);

    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 8_000 + 16_000);
    expect(queryFn).toHaveBeenCalledTimes(6);
    expect(observer.getCurrentResult().status).toBe('error');
    unsubscribe();
  });

  it('cancels a hung first-load fetch and refetches when the backend reconnects', async () => {
    uninstall = installQueryRecovery(client);
    const queryFn = vi.fn()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce([{ name: 'overdeck' }]);
    const { observer, unsubscribe } = observe(client, ['command-deck-projects', 0], queryFn);

    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(1);

    // Invalidation alone joins the hung first-load promise.
    void client.invalidateQueries({ queryKey: ['command-deck-projects'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new CustomEvent(BACKEND_RECONNECTED_EVENT));
    await vi.advanceTimersByTimeAsync(0);

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data).toEqual([{ name: 'overdeck' }]);
    unsubscribe();
  });

  it('refetches settled conversation data on reconnect and ignores unrelated queries', async () => {
    uninstall = installQueryRecovery(client);
    const conversations = vi.fn().mockResolvedValue([]);
    const unrelated = vi.fn().mockResolvedValue('x');
    const a = observe(client, ['conversations'], conversations);
    const b = observe(client, ['settings'], unrelated);
    await vi.advanceTimersByTimeAsync(0);

    window.dispatchEvent(new CustomEvent(BACKEND_RECONNECTED_EVENT));
    await vi.advanceTimersByTimeAsync(0);

    expect(conversations).toHaveBeenCalledTimes(2);
    expect(unrelated).toHaveBeenCalledTimes(1);
    a.unsubscribe();
    b.unsubscribe();
  });

  it('stops listening once uninstalled', async () => {
    const uninstallNow = installQueryRecovery(client);
    const queryFn = vi.fn().mockResolvedValue([]);
    const { unsubscribe } = observe(client, ['conversations'], queryFn);
    await vi.advanceTimersByTimeAsync(0);

    uninstallNow();
    window.dispatchEvent(new CustomEvent(BACKEND_RECONNECTED_EVENT));
    await vi.advanceTimersByTimeAsync(0);

    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
