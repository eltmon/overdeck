import { describe, expect, it, vi } from 'vitest';

import { disableBdMetricsSync } from '../install.js';

describe('disableBdMetricsSync', () => {
  it('disables bd metrics without opening a project tasks store', () => {
    const run = vi.fn();

    expect(disableBdMetricsSync(run)).toBe(true);
    expect(run).toHaveBeenCalledWith(
      'bd',
      ['metrics', 'off'],
      { stdio: 'pipe', timeout: 10_000 },
    );
  });

  it('is non-fatal when bd rejects the configuration change', () => {
    const run = vi.fn(() => {
      throw new Error('bd unavailable');
    });

    expect(disableBdMetricsSync(run)).toBe(false);
  });
});
