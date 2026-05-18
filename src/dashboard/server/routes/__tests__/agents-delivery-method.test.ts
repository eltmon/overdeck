import { beforeEach, describe, expect, it } from 'vitest';

import { validateAgentDeliveryMethodOrigin } from '../agents.js';
import { _resetTrustedOriginsForTests } from '../origin-validation.js';

describe('agent delivery-method route', () => {
  beforeEach(() => {
    delete process.env.NODE_ENV;
    process.env.PORT = '3011';
    delete process.env.DASHBOARD_URL;
    _resetTrustedOriginsForTests();
  });

  it('rejects cross-origin POSTs before mutating delivery method', () => {
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
});
