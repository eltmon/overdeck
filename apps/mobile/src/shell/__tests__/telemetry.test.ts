import { describe, expect, it, vi } from 'vitest';
import type { TelemetryClientConfig } from '@overdeck/contracts';
import type { ConnectionPhase } from '../../../../../src/dashboard/frontend/src/lib/connectionState';
import { bootPhoneTelemetry, TELEMETRY_CACHE_PREFIX } from '../telemetry';

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    _store: store,
  };
}

/** A stub subscribePhase whose emitted phases are driven by the test. */
function fakePhaseSubscription() {
  let listener: ((phase: ConnectionPhase) => void) | null = null;
  return {
    subscribePhase: (l: (phase: ConnectionPhase) => void) => {
      listener = l;
      return () => { listener = null; };
    },
    emit: (phase: ConnectionPhase) => listener?.(phase),
    hasListener: () => listener !== null,
  };
}

const ON_CONFIG: TelemetryClientConfig = {
  effectiveEnabled: true,
  installId: '123e4567-e89b-42d3-a456-426614174000',
  installKind: 'user',
  posthogKey: 'phc_test',
  posthogHost: 'https://us.i.posthog.com',
};

describe('bootPhoneTelemetry', () => {
  it('never calls init and removes the cache entry when the machine answers off', async () => {
    const storage = fakeStorage();
    const init = vi.fn();
    const disable = vi.fn();
    const fetchConfig = vi.fn(async () => ({ effectiveEnabled: false }) as TelemetryClientConfig);

    await bootPhoneTelemetry({ environmentId: 'e-1', storage, init, disable, fetchConfig, platform: () => 'ios', subscribePhase: () => () => {} });

    expect(init).not.toHaveBeenCalled();
    expect(disable).toHaveBeenCalledTimes(1);
    expect(storage.getItem(`${TELEMETRY_CACHE_PREFIX}e-1`)).toBeNull();
  });

  it('removes a cached on entry when a fresh off answer arrives, without calling init for it', async () => {
    const storage = fakeStorage({ [`${TELEMETRY_CACHE_PREFIX}e-1`]: JSON.stringify(ON_CONFIG) });
    const init = vi.fn();
    const disable = vi.fn();
    const fetchConfig = vi.fn(async () => ({ effectiveEnabled: false }) as TelemetryClientConfig);

    await bootPhoneTelemetry({ environmentId: 'e-1', storage, init, disable, fetchConfig, platform: () => 'ios', subscribePhase: () => () => {} });

    // init runs once, from the cache, before the fresh off answer disables it.
    expect(init).toHaveBeenCalledTimes(1);
    expect(disable).toHaveBeenCalledTimes(1);
    expect(storage.getItem(`${TELEMETRY_CACHE_PREFIX}e-1`)).toBeNull();
  });

  it('calls init once with client phone and machineIdentity true, and persists the answer', async () => {
    const storage = fakeStorage();
    const init = vi.fn();
    const fetchConfig = vi.fn(async () => ON_CONFIG);

    await bootPhoneTelemetry({ environmentId: 'e-1', storage, init, fetchConfig, platform: () => 'ios', subscribePhase: () => () => {} });

    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(ON_CONFIG, expect.objectContaining({
      client: 'phone',
      machineIdentity: true,
      platform: 'ios',
    }));
    expect(JSON.parse(storage.getItem(`${TELEMETRY_CACHE_PREFIX}e-1`)!)).toEqual(ON_CONFIG);
  });

  it('initializes from the cache when the fetch returns null (link down)', async () => {
    const storage = fakeStorage({ [`${TELEMETRY_CACHE_PREFIX}e-1`]: JSON.stringify(ON_CONFIG) });
    const init = vi.fn();
    const fetchConfig = vi.fn(async () => null);

    await bootPhoneTelemetry({ environmentId: 'e-1', storage, init, fetchConfig, platform: () => 'ios', subscribePhase: () => () => {} });

    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(ON_CONFIG, expect.objectContaining({ client: 'phone' }));
  });

  it('calls disable given a cached on answer and a fresh off answer', async () => {
    const storage = fakeStorage({ [`${TELEMETRY_CACHE_PREFIX}e-1`]: JSON.stringify(ON_CONFIG) });
    const init = vi.fn();
    const disable = vi.fn();
    const fetchConfig = vi.fn(async () => ({ effectiveEnabled: false }) as TelemetryClientConfig);

    await bootPhoneTelemetry({ environmentId: 'e-1', storage, init, disable, fetchConfig, platform: () => 'ios', subscribePhase: () => () => {} });

    expect(disable).toHaveBeenCalledTimes(1);
  });

  it('resolves even when fetchConfig throws', async () => {
    const storage = fakeStorage();
    const fetchConfig = vi.fn(async () => { throw new Error('network down'); });

    await expect(bootPhoneTelemetry({ environmentId: 'e-1', storage, fetchConfig, platform: () => 'ios', subscribePhase: () => () => {} }))
      .resolves.toBeTypeOf('function');
  });

  it('never initializes when there is nothing cached and the machine is unreachable', async () => {
    const storage = fakeStorage();
    const init = vi.fn();
    const fetchConfig = vi.fn(async () => null);

    await bootPhoneTelemetry({ environmentId: 'e-1', storage, init, fetchConfig, platform: () => 'ios', subscribePhase: () => () => {} });

    expect(init).not.toHaveBeenCalled();
  });

  it('ignores a cached entry that is missing posthogKey/posthogHost', async () => {
    const storage = fakeStorage({ [`${TELEMETRY_CACHE_PREFIX}e-1`]: JSON.stringify({ effectiveEnabled: true }) });
    const init = vi.fn();
    const fetchConfig = vi.fn(async () => null);

    await bootPhoneTelemetry({ environmentId: 'e-1', storage, init, fetchConfig, platform: () => 'ios', subscribePhase: () => () => {} });

    expect(init).not.toHaveBeenCalled();
  });

  // PAN-5100 WI-6 "Refresh on reconnect"
  it('re-fetches on every transition into live, applying a fresh off after a failed initial read', async () => {
    const storage = fakeStorage({ [`${TELEMETRY_CACHE_PREFIX}e-1`]: JSON.stringify(ON_CONFIG) });
    const init = vi.fn();
    const disable = vi.fn();
    const answers: Array<TelemetryClientConfig | null> = [null, { effectiveEnabled: false }];
    const fetchConfig = vi.fn(async () => answers.shift() ?? null);
    const phases = fakePhaseSubscription();

    const unsubscribe = await bootPhoneTelemetry({
      environmentId: 'e-1',
      storage,
      init,
      disable,
      fetchConfig,
      platform: () => 'ios',
      subscribePhase: phases.subscribePhase,
    });

    // Cached "on" applied immediately; the initial fetch resolves null (link down).
    expect(init).toHaveBeenCalledTimes(1);
    expect(disable).not.toHaveBeenCalled();
    expect(fetchConfig).toHaveBeenCalledTimes(1);

    phases.emit('delayed');
    expect(fetchConfig).toHaveBeenCalledTimes(1);

    phases.emit('live');
    await vi.waitFor(() => expect(fetchConfig).toHaveBeenCalledTimes(2));
    expect(disable).toHaveBeenCalledTimes(1);
    expect(storage.getItem(`${TELEMETRY_CACHE_PREFIX}e-1`)).toBeNull();

    unsubscribe();
    expect(phases.hasListener()).toBe(false);
  });
});
