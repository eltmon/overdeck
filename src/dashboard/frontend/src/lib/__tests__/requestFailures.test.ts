import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyFetchRejection,
  installRequestFailureObserver,
  REQUEST_FAILURE_THROTTLE_MS,
} from '../requestFailures';

function makeTarget(fetchImpl: typeof fetch, host = 'overdeck.localhost') {
  return { fetch: fetchImpl, location: { host } };
}

describe('installRequestFailureObserver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports exactly one client_request_failed for a 500 and returns the original response', async () => {
    const response = new Response(null, { status: 500 });
    const innerFetch = vi.fn(async () => response);
    const report = vi.fn();
    const target = makeTarget(innerFetch as unknown as typeof fetch);
    installRequestFailureObserver({ client: 'desktop', target, report });

    const result = await target.fetch('/api/conversations');

    expect(result).toBe(response);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({
      client: 'desktop',
      route: '/api/conversations',
      route_area: 'conversations',
      method: 'GET',
      status: '500',
    });
  });

  it('throttles a second identical failure within 60s, then reports again after the window', async () => {
    const response = new Response(null, { status: 500 });
    const innerFetch = vi.fn(async () => response);
    const report = vi.fn();
    const target = makeTarget(innerFetch as unknown as typeof fetch);
    installRequestFailureObserver({ client: 'desktop', target, report });

    await target.fetch('/api/conversations');
    await vi.advanceTimersByTimeAsync(1_000);
    await target.fetch('/api/conversations');
    expect(report).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(REQUEST_FAILURE_THROTTLE_MS);
    await target.fetch('/api/conversations');
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('never reports a 2xx response', async () => {
    const response = new Response(null, { status: 200 });
    const innerFetch = vi.fn(async () => response);
    const report = vi.fn();
    const target = makeTarget(innerFetch as unknown as typeof fetch);
    installRequestFailureObserver({ client: 'desktop', target, report });

    const result = await target.fetch('/api/conversations');

    expect(result).toBe(response);
    expect(report).not.toHaveBeenCalled();
  });

  it('never reports a cross-host URL', async () => {
    const response = new Response(null, { status: 500 });
    const innerFetch = vi.fn(async () => response);
    const report = vi.fn();
    const target = makeTarget(innerFetch as unknown as typeof fetch);
    installRequestFailureObserver({ client: 'desktop', target, report });

    await target.fetch('https://us.i.posthog.com/e/');

    expect(report).not.toHaveBeenCalled();
  });

  it('rethrows a TypeError unchanged and reports network', async () => {
    const original = new TypeError('Failed to fetch');
    const innerFetch = vi.fn(async () => { throw original; });
    const report = vi.fn();
    const target = makeTarget(innerFetch as unknown as typeof fetch);
    installRequestFailureObserver({ client: 'desktop', target, report });

    await expect(target.fetch('/api/conversations')).rejects.toBe(original);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: 'network' }));
  });

  it('classifies a DOMException TimeoutError as timeout and rethrows it', async () => {
    const original = new DOMException('timed out', 'TimeoutError');
    const innerFetch = vi.fn(async () => { throw original; });
    const report = vi.fn();
    const target = makeTarget(innerFetch as unknown as typeof fetch);
    installRequestFailureObserver({ client: 'desktop', target, report });

    await expect(target.fetch('/api/conversations')).rejects.toBe(original);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: 'timeout' }));
  });

  it('classifies a DOMException AbortError as aborted and rethrows it', async () => {
    const original = new DOMException('aborted', 'AbortError');
    const innerFetch = vi.fn(async () => { throw original; });
    const report = vi.fn();
    const target = makeTarget(innerFetch as unknown as typeof fetch);
    installRequestFailureObserver({ client: 'desktop', target, report });

    await expect(target.fetch('/api/conversations')).rejects.toBe(original);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: 'aborted' }));
  });

  it('never changes the resolved response when report throws', async () => {
    const response = new Response(null, { status: 500 });
    const innerFetch = vi.fn(async () => response);
    const report = vi.fn(() => { throw new Error('report blew up'); });
    const target = makeTarget(innerFetch as unknown as typeof fetch);
    installRequestFailureObserver({ client: 'desktop', target, report });

    const result = await target.fetch('/api/conversations');

    expect(result).toBe(response);
  });

  it('never leaks a path segment outside the closed route/route_area domains', async () => {
    const response = new Response(null, { status: 500 });
    const innerFetch = vi.fn(async () => response);
    const report = vi.fn();
    const target = makeTarget(innerFetch as unknown as typeof fetch);
    installRequestFailureObserver({ client: 'desktop', target, report });

    await target.fetch('/api/projects/secret-key/thing');

    expect(report).toHaveBeenCalledTimes(1);
    const payload = report.mock.calls[0]?.[0];
    expect(JSON.stringify(payload)).not.toContain('secret-key');
  });

  it('is a no-op on a second install for the same target, returning the same uninstaller', () => {
    const innerFetch = vi.fn(async () => new Response());
    const target = makeTarget(innerFetch as unknown as typeof fetch);

    const first = installRequestFailureObserver({ client: 'desktop', target });
    const second = installRequestFailureObserver({ client: 'desktop', target });

    expect(second).toBe(first);
  });
});

describe('classifyFetchRejection', () => {
  it('classifies a TypeError as network', () => {
    expect(classifyFetchRejection(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('classifies a DOMException TimeoutError as timeout', () => {
    expect(classifyFetchRejection(new DOMException('t', 'TimeoutError'))).toBe('timeout');
  });

  it('classifies a DOMException AbortError as aborted', () => {
    expect(classifyFetchRejection(new DOMException('a', 'AbortError'))).toBe('aborted');
  });

  it('classifies anything else as network', () => {
    expect(classifyFetchRejection('not an error')).toBe('network');
  });
});
