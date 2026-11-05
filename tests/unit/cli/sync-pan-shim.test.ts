/**
 * PAN-2630 (WI-4): `pan sync` (re)writes the pan/overdeck PATH shim, skipped
 * under `--dry-run`. A write failure never fails the sync.
 */
import { describe, expect, it, vi } from 'vitest';

import { syncPanCliShimStep } from '../../../src/cli/commands/sync.js';
import type { PanCliShimWriteResult } from '../../../src/lib/pan-cli-shim.js';

describe('syncPanCliShimStep', () => {
  it('logs the shim directory on a successful write', async () => {
    const log = vi.fn();
    const write = vi.fn(async (): Promise<PanCliShimWriteResult> => ({ status: 'written', dir: '/h/cli-bin' }));

    await syncPanCliShimStep({ write, log });

    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pan shim → /h/cli-bin'));
  });

  it('logs a warning for a missing CLI bundle', async () => {
    const log = vi.fn();
    const write = vi.fn(async (): Promise<PanCliShimWriteResult> => ({ status: 'missing-bundle', bundle: '/r/dist/cli/index.js' }));

    await syncPanCliShimStep({ write, log });

    expect(log).toHaveBeenCalledWith(expect.stringContaining('pan shim not written: CLI bundle missing at /r/dist/cli/index.js'));
  });

  it('logs a warning and resolves without throwing on error', async () => {
    const log = vi.fn();
    const write = vi.fn(async (): Promise<PanCliShimWriteResult> => ({ status: 'error', message: 'disk full' }));

    await expect(syncPanCliShimStep({ write, log })).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(expect.stringContaining('pan shim not written: disk full'));
  });
});
