import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const posthogMock = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthogMock }));

describe('frontend telemetry wrapper', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not capture events before initialization', async () => {
    const { capture } = await import('../telemetry');

    capture('project_created', { mode: 'new' });

    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it('never initializes PostHog when settings disable telemetry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ telemetry: { enabled: false, installId: 'install-id' } }),
    })));
    const { initTelemetry } = await import('../telemetry');

    await initTelemetry();

    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.register).not.toHaveBeenCalled();
  });

  it('initializes exception capture and registers the anonymous install ID', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ telemetry: { enabled: true, installId: 'install-id' } }),
    })));
    const { initTelemetry } = await import('../telemetry');

    await initTelemetry();

    expect(posthogMock.init).toHaveBeenCalledTimes(1);
    expect(posthogMock.init.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      person_profiles: 'identified_only',
      capture_exceptions: true,
    }));
    expect(posthogMock.register).toHaveBeenCalledWith({ install_id: 'install-id' });
  });
});
