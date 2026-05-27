import { beforeEach, describe, expect, it } from 'vitest';

import { validateAgentDeliveryMethodOrigin, validateAgentMessageOrigin, validateAgentRuntimeEventAuth } from '../agents.js';
import { _resetTrustedOriginsForTests } from '../origin-validation.js';

describe('agent mutation origin validation', () => {
  beforeEach(() => {
    delete process.env.NODE_ENV;
    process.env.PORT = '3011';
    delete process.env.DASHBOARD_URL;
    delete process.env.PANOPTICON_INTERNAL_TOKEN;
    _resetTrustedOriginsForTests();
  });

  it('rejects cross-origin delivery method POSTs before mutating delivery method', () => {
    const result = validateAgentDeliveryMethodOrigin({
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
      },
    } as any);

    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { error: 'forbidden' },
    });
  });

  it('rejects cross-origin message and tell POSTs before delivering agent instructions', () => {
    const result = validateAgentMessageOrigin({
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
      },
    } as any);

    expect(result.ok).toBe(false);
  });

  it('rejects missing-origin message and tell POSTs before delivering agent instructions', () => {
    const result = validateAgentMessageOrigin({
      method: 'POST',
      headers: {},
    } as any);

    expect(result.ok).toBe(false);
  });

  it('rejects agent runtime event POSTs without the internal token', async () => {
    process.env.PANOPTICON_INTERNAL_TOKEN = 'test-token';

    const result = await validateAgentRuntimeEventAuth({
      method: 'POST',
      headers: {},
    } as any);

    expect(result.ok).toBe(false);
  });

  it('allows agent runtime event POSTs with the internal token', async () => {
    process.env.PANOPTICON_INTERNAL_TOKEN = 'test-token';

    const result = await validateAgentRuntimeEventAuth({
      method: 'POST',
      headers: { 'x-panopticon-internal-token': 'test-token' },
    } as any);

    expect(result.ok).toBe(true);
  });
});
