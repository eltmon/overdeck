import { describe, expect, it } from 'vitest';

import { getDeployStaleness } from '../system-health-service.js';

describe('deploy staleness health surface', () => {
  it('reports no staleness now that the deploy patrol is gone (PAN-3917 D1)', async () => {
    await expect(getDeployStaleness()).resolves.toBeNull();
  });
});
