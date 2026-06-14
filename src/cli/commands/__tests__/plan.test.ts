import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const spinner = {
  start: vi.fn(() => spinner),
  succeed: vi.fn(),
  fail: vi.fn(),
  text: '',
};

vi.mock('ora', () => ({
  default: vi.fn(() => spinner),
}));

vi.mock('../../../lib/config.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/config.js')>()),
  getDashboardApiUrlSync: () => 'http://pan.test',
}));

describe('planCommand', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    spinner.text = '';
    global.fetch = vi.fn(async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        }),
      },
    })) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends autoStart when --auto-start is provided', async () => {
    const { planCommand } = await import('../plan.js');

    await planCommand('PAN-123', { auto: true, autoStart: true });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://pan.test/api/issues/PAN-123/start-planning',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body).toMatchObject({
      auto: true,
      autoStart: true,
    });
  });

  it('sends probe when --probe is provided', async () => {
    const { planCommand } = await import('../plan.js');

    await planCommand('PAN-123', { probe: true });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body).toMatchObject({
      probe: true,
    });
  });
});
