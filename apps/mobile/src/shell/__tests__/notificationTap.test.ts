import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installNotificationTap, safeMobilePath, type TapDeps, tapTarget } from '../notificationTap';
import type { PairedMachine } from '../types';

const MACHINE: PairedMachine = {
  environmentId: 'env-1',
  label: 'Desk',
  machineKeyHex: 'aa'.repeat(32),
  linkPublicKeyHex: 'bb'.repeat(32),
  linkSecretKeyHex: 'cc'.repeat(32),
  token: 't',
  tokenId: 'tid',
  pairedAt: '2026-11-03T00:00:00.000Z',
};

beforeEach(() => {
  sessionStorage.clear();
});

describe('safeMobilePath', () => {
  it('keeps same-origin /m paths with their query', () => {
    expect(safeMobilePath('/m?subject=a')).toBe('/m?subject=a');
    expect(safeMobilePath('/m/x?y=1')).toBe('/m/x?y=1');
  });

  it('returns /m for another origin, a scheme, another path or a non-string', () => {
    for (const url of ['https://evil.example/m', '//evil.example/m', 'javascript:alert(1)', '/settings', '/mx', '', undefined, 42]) {
      expect(safeMobilePath(url)).toBe('/m');
    }
  });
});

describe('tapTarget', () => {
  it('opens a paired machine at its path, the machine list for an unknown one, and nothing without a machine', () => {
    expect(tapTarget({ machine: 'env-1', url: '/m?subject=conv-1' }, [MACHINE])).toEqual({
      kind: 'machine',
      environmentId: 'env-1',
      path: '/m?subject=conv-1',
    });
    expect(tapTarget({ machine: 'env-2', url: '/m' }, [MACHINE])).toEqual({ kind: 'machines' });
    expect(tapTarget({ url: '/m' }, [MACHINE])).toBeNull();
    expect(tapTarget(undefined, [MACHINE])).toBeNull();
  });
});

describe('installNotificationTap', () => {
  function setup(signedIn = true) {
    let listener: ((action: unknown) => void) | undefined;
    const remove = vi.fn(async () => {});
    const plugin = {
      addListener: vi.fn(async (_event: string, fn: (action: unknown) => void) => {
        listener = fn;
        return { remove };
      }),
    } as unknown as NonNullable<TapDeps['plugin']>;
    const open = vi.fn();
    const uninstall = installNotificationTap({ plugin, paired: () => [MACHINE], signedIn: () => signedIn, open });
    const tap = (id: string) => listener?.({ actionId: 'tap', notification: { id, data: { machine: 'env-1', url: '/m' } } });
    return { tap, open, uninstall, remove, plugin };
  }

  it('opens once for two deliveries of the same notification', async () => {
    const { tap, open, plugin } = setup();
    await Promise.resolve();
    expect(plugin.addListener).toHaveBeenCalledWith('pushNotificationActionPerformed', expect.any(Function));
    tap('n-1');
    tap('n-1');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ kind: 'machine', environmentId: 'env-1', path: '/m' });
    tap('n-2');
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('ignores taps while signed out', async () => {
    const { tap, open } = setup(false);
    await Promise.resolve();
    tap('n-1');
    expect(open).not.toHaveBeenCalled();
  });

  it('removes the listener on uninstall', async () => {
    const { uninstall, remove } = setup();
    uninstall();
    await Promise.resolve();
    await Promise.resolve();
    expect(remove).toHaveBeenCalled();
  });
});
