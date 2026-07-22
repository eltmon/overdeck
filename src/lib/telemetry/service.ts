import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostHog } from 'posthog-node';
import type { TelemetryEventName, TelemetryPropertiesFor } from '@overdeck/contracts';
import { packageRoot } from '../paths.js';
import { resolveTelemetryEnabled } from './config.js';
import { getOrCreateInstallId } from './install-id.js';

const DEFAULT_POSTHOG_API_KEY = 'phc_pwvHeDutnCmAm8tZh5hRaQ7mMoho3T9gb4t4qRjK2Zjt';
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const SHUTDOWN_TIMEOUT_MS = 2_000;
const FLAG_TIMEOUT_MS = 500;

export type AnalyticsClientType = 'cli' | 'server';

export interface AnalyticsServiceOptions {
  featureFlagOverrides?: Readonly<Record<string, boolean>>;
}

let cachedOverdeckVersion: string | undefined;

function getOverdeckVersion(): string {
  if (cachedOverdeckVersion) return cachedOverdeckVersion;
  try {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown };
    cachedOverdeckVersion = typeof manifest.version === 'string' ? manifest.version : 'unknown';
  } catch {
    cachedOverdeckVersion = 'unknown';
  }
  return cachedOverdeckVersion;
}

function telemetryBlockedForProcess(): boolean {
  return Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';
}

export class AnalyticsService {
  private client: PostHog | undefined;

  constructor(
    private readonly clientType: AnalyticsClientType,
    private readonly options: AnalyticsServiceOptions = {},
  ) {}

  capture<Event extends TelemetryEventName>(
    event: Event,
    properties: TelemetryPropertiesFor<Event>,
  ): void {
    const client = this.getClient();
    if (!client) return;

    try {
      client.capture({
        distinctId: getOrCreateInstallId(),
        event,
        properties: {
          ...properties,
          $process_person_profile: false,
          platform: process.platform,
          arch: process.arch,
          overdeckVersion: getOverdeckVersion(),
          clientType: this.clientType,
        },
      });
    } catch {
      // Analytics must never fail the caller.
    }
  }

  async isFeatureEnabled(flag: string, fallback: boolean): Promise<boolean> {
    const override = this.options.featureFlagOverrides?.[flag];
    if (typeof override === 'boolean') return override;

    const client = this.getClient();
    if (!client) return fallback;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        client.isFeatureEnabled(flag, getOrCreateInstallId(), {
          sendFeatureFlagEvents: false,
        }),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(fallback), FLAG_TIMEOUT_MS);
        }),
      ]);
      return typeof result === 'boolean' ? result : fallback;
    } catch {
      return fallback;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async shutdown(): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.client = undefined;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve(client.shutdown(SHUTDOWN_TIMEOUT_MS)),
        new Promise<void>((resolve) => { timeout = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS); }),
      ]);
    } catch {
      // Analytics must never fail shutdown.
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private getClient(): PostHog | undefined {
    if (this.client) return this.client;
    if (telemetryBlockedForProcess()) return undefined;

    try {
      if (!resolveTelemetryEnabled()) return undefined;
      this.client = new PostHog(
        process.env.POSTHOG_API_KEY ?? DEFAULT_POSTHOG_API_KEY,
        {
          host: process.env.POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
          enableExceptionAutocapture: this.clientType === 'server',
        },
      );
      return this.client;
    } catch {
      return undefined;
    }
  }
}
