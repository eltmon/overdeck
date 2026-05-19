import { beforeEach, describe, expect, it } from 'vitest';

import { validateAgentDeliveryMethodOrigin, validateAgentMessageOrigin } from '../agents.js';
import { _resetTrustedOriginsForTests } from '../origin-validation.js';

describe('agent mutation origin validation', () => {
  beforeEach(() => {
    delete process.env.NODE_ENV;
    process.env.PORT = '3011';
    delete process.env.DASHBOARD_URL;
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
});
