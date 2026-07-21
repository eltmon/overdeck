import { beforeEach, describe, expect, it, vi } from 'vitest';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock('sonner', () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));

import { createUatActionHandler } from './uat-action-handlers';

describe('UAT action prerequisite gate', () => {
  const open = vi.fn();
  const queryClient = { invalidateQueries: vi.fn() } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('open', open);
  });

  it('opens UAT only after Docker, Traefik, and HTTPS prerequisites are ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ready: true }), { status: 200 })));
    const handler = createUatActionHandler({
      issueId: 'PAN-1',
      workspace: { frontendUrl: 'https://web-feature-pan-1.overdeck.localhost' } as any,
      queryClient,
    });

    await handler({ id: 'open-uat', label: 'Open UAT' } as any);

    expect(fetch).toHaveBeenCalledWith('/api/prereqs/enableHttps', expect.any(Object));
    expect(open).toHaveBeenCalledWith('https://web-feature-pan-1.overdeck.localhost', '_blank', 'noopener,noreferrer');
  });

  it('shows actionable setup guidance instead of opening a dead UAT URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ready: false,
      missing: ['docker', 'traefik'],
    }), { status: 200 })));
    const handler = createUatActionHandler({
      issueId: 'PAN-1',
      workspace: { frontendUrl: 'https://web-feature-pan-1.overdeck.localhost' } as any,
      queryClient,
    });

    await handler({ id: 'open-uat', label: 'Open UAT' } as any);

    expect(open).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('install/start Docker first'));
  });
});
