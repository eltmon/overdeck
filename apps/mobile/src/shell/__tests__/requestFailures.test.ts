/** PAN-5100 WI-8: the shared request-failure observer, installed on the phone with client 'phone'. */
import { describe, expect, it, vi } from 'vitest';
import { installRequestFailureObserver } from '../../../../../src/dashboard/frontend/src/lib/requestFailures';

describe('installRequestFailureObserver on the phone', () => {
  it('reports client phone for a 503 on /api/conversations', async () => {
    const response = new Response(null, { status: 503 });
    const innerFetch = vi.fn(async () => response);
    const report = vi.fn();
    const target = { fetch: innerFetch as unknown as typeof fetch, location: { host: 'overdeck.localhost' } };

    installRequestFailureObserver({ client: 'phone', target, report });
    await target.fetch('/api/conversations');

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({
      client: 'phone',
      route: '/api/conversations',
      route_area: 'conversations',
      method: 'GET',
      status: '503',
    });
  });
});
