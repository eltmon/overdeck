import type { TelemetryClientConfig } from '@overdeck/contracts';
import { disableTelemetry, initTelemetryFromConfig } from '../../../../src/dashboard/frontend/src/lib/telemetry';
import { APP_VERSION } from './config';
import { shellPlatform } from './platform';

/** PAN-5100 D-10: initialize the frontend telemetry door from the machine's setting. */
export const TELEMETRY_CACHE_PREFIX = 'overdeck.telemetry.';

export interface PhoneTelemetryDeps {
  environmentId: string;
  /** Default: `fetch('/api/telemetry/client-config')`; a non-OK response or a throw resolve to `null`. */
  fetchConfig?: () => Promise<TelemetryClientConfig | null>;
  /** Default: `localStorage`. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  init?: typeof initTelemetryFromConfig;
  disable?: typeof disableTelemetry;
  /** Default: `shellPlatform`. */
  platform?: () => 'ios' | 'android';
}

async function defaultFetchConfig(): Promise<TelemetryClientConfig | null> {
  try {
    const response = await fetch('/api/telemetry/client-config');
    if (!response.ok) return null;
    return await response.json() as TelemetryClientConfig;
  } catch {
    return null;
  }
}

function readCachedConfig(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  cacheKey: string,
): TelemetryClientConfig | null {
  try {
    const raw = storage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TelemetryClientConfig;
    if (parsed.effectiveEnabled === true && parsed.posthogKey && parsed.posthogHost) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * PAN-5100 D-10: initializes the browser telemetry door from the machine's
 * `GET /api/telemetry/client-config` answer, with a per-machine cached
 * answer applied immediately so a link that is down from the start is
 * still reported. Never rejects.
 */
export async function bootPhoneTelemetry(deps: PhoneTelemetryDeps): Promise<void> {
  const storage = deps.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  const init = deps.init ?? initTelemetryFromConfig;
  const disable = deps.disable ?? disableTelemetry;
  const platform = deps.platform ?? shellPlatform;
  const cacheKey = `${TELEMETRY_CACHE_PREFIX}${deps.environmentId}`;

  function applyConfig(config: TelemetryClientConfig): void {
    init(config, {
      client: 'phone',
      platform: platform(),
      appVersion: APP_VERSION,
      posthogKey: config.posthogKey ?? '',
      posthogHost: config.posthogHost ?? '',
      machineIdentity: true,
    });
  }

  try {
    if (storage) {
      const cached = readCachedConfig(storage, cacheKey);
      if (cached) applyConfig(cached);
    }
  } catch {
    // Telemetry must never block boot.
  }

  try {
    const fetchConfig = deps.fetchConfig ?? defaultFetchConfig;
    const fresh = await fetchConfig();
    if (fresh === null) return;

    if (fresh.effectiveEnabled === false) {
      disable();
      storage?.removeItem(cacheKey);
      return;
    }

    storage?.setItem(cacheKey, JSON.stringify(fresh));
    applyConfig(fresh);
  } catch {
    // Telemetry must never reject the caller.
  }
}
