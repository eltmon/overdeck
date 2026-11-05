/**
 * PAN-2630 (WI-3): `pan install` writes the pan/overdeck PATH shim and hints
 * at the PATH line to add when `pan` still isn't resolvable afterward.
 */
import { describe, expect, it, vi } from 'vitest';

import { installPanCliShimStep } from '../../../src/cli/commands/install.js';
import type { PanCliShimWriteResult } from '../../../src/lib/pan-cli-shim.js';

describe('installPanCliShimStep', () => {
  it('logs the export PATH line when pan is absent from PATH', async () => {
    const log = vi.fn();
    const write = vi.fn(async (): Promise<PanCliShimWriteResult> => ({ status: 'written', dir: '/h/cli-bin' }));
    const find = vi.fn(() => null);

    await installPanCliShimStep({ write, pathEnv: '/usr/bin', find, log });

    expect(log).toHaveBeenCalledWith(expect.stringContaining('pan shim written to /h/cli-bin'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('export PATH="/h/cli-bin:$PATH"'));
  });

  it('does not log the PATH hint when pan is already resolvable', async () => {
    const log = vi.fn();
    const write = vi.fn(async (): Promise<PanCliShimWriteResult> => ({ status: 'written', dir: '/h/cli-bin' }));
    const find = vi.fn(() => '/h/cli-bin/pan');

    await installPanCliShimStep({ write, pathEnv: '/h/cli-bin:/usr/bin', find, log });

    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pan shim written to /h/cli-bin'));
  });

  it('logs a warning and resolves without throwing on error', async () => {
    const log = vi.fn();
    const write = vi.fn(async (): Promise<PanCliShimWriteResult> => ({ status: 'error', message: 'disk full' }));
    const find = vi.fn(() => null);

    await expect(installPanCliShimStep({ write, pathEnv: undefined, find, log })).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(expect.stringContaining('pan shim not written: disk full'));
  });

  it('logs a warning for a missing CLI bundle', async () => {
    const log = vi.fn();
    const write = vi.fn(async (): Promise<PanCliShimWriteResult> => ({ status: 'missing-bundle', bundle: '/r/dist/cli/index.js' }));
    const find = vi.fn(() => null);

    await installPanCliShimStep({ write, pathEnv: undefined, find, log });

    expect(log).toHaveBeenCalledWith(expect.stringContaining('pan shim not written: CLI bundle missing at /r/dist/cli/index.js'));
  });
});
