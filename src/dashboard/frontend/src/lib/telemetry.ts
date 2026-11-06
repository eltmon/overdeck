import posthog, { type CaptureResult, type Properties } from 'posthog-js';
import type {
  TelemetryClient,
  TelemetryCountBucket,
  TelemetryEventName,
  TelemetryInstallKind,
  TelemetryPropertiesFor,
} from '@overdeck/contracts';

/** PAN-5100: the shape `GET /api/settings`'s telemetry block and `TelemetryClientConfig` both satisfy. */
export interface TelemetryInitConfig {
  enabled?: boolean;
  effectiveEnabled?: boolean;
  installId?: string;
  /** PAN-5084: what kind of install reported telemetry. */
  installKind?: TelemetryInstallKind;
  /** PAN-4264: present only when operator grouping is on and a hash exists. */
  operatorHash?: string;
  /** PAN-5100: the machine's build commit, when the build has one. */
  buildCommit?: string;
}

interface TelemetrySettingsResponse {
  telemetry?: TelemetryInitConfig;
}

/** PAN-5100: common properties registered once (D-5) and sent on every later event. */
export interface TelemetryClientContext {
  client: TelemetryClient;
  platform: 'ios' | 'android' | 'web';
  /** Phone only. */
  appVersion?: string;
  /** Phone: the client config's key/host; desktop: the build env key/host. */
  posthogKey: string;
  posthogHost: string;
  /** Phone: in-memory persistence and distinct_id = installId (D-3, D-4). */
  machineIdentity?: boolean;
}

export type TelemetryExceptionAction =
  | 'agent_spawn'
  | 'merge'
  | 'force_merge'
  | 'frontend_recovery_reload'
  | 'frontend_recovery_reload_loop'
  | 'frontend_unhandled_error';

export interface TelemetryExceptionContext {
  action: TelemetryExceptionAction;
  trigger?:
    | 'vite_preload_error'
    | 'asset_load_error'
    | 'window_module_error'
    | 'unhandled_rejection'
    | 'root_error_boundary';
  reload_count?: TelemetryCountBucket;
  should_reload?: boolean;
}

let initialized = false;
let currentTelemetryClient: TelemetryClient | null = null;

/** The client passed to the active init, or null before init. */
export function telemetryClient(): TelemetryClient | null {
  return currentTelemetryClient;
}

const PRIVATE_BROWSER_PROPERTY_FRAGMENTS = [
  'campaign',
  'pathname',
  'referrer',
  'referring_domain',
  'session_entry',
  'url',
];
const CLICK_ID_PROPERTIES = new Set([
  'dclid',
  'epik',
  'fbclid',
  'gclid',
  'gclsrc',
  'igshid',
  'irclid',
  'li_fat_id',
  'mc_cid',
  'msclkid',
  'rdt_cid',
  'ttclid',
  'twclid',
]);

function sanitizeBrowserProperties(properties: Properties | undefined): Properties | undefined {
  if (!properties) return properties;
  const sanitized = { ...properties };
  for (const key of Object.keys(sanitized)) {
    const normalized = key.toLowerCase().replace(/^\$/, '');
    if (
      normalized.startsWith('utm_') ||
      CLICK_ID_PROPERTIES.has(normalized) ||
      PRIVATE_BROWSER_PROPERTY_FRAGMENTS.some((fragment) => normalized.includes(fragment))
    ) {
      delete sanitized[key];
    }
  }
  return sanitized;
}

export function sanitizePostHogEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return null;
  const properties = sanitizeBrowserProperties(event.properties) ?? {};
  if (event.event === '$exception') {
    for (const key of Object.keys(properties)) {
      if (key.startsWith('$exception_') && key !== '$exception_level') delete properties[key];
    }
    properties.$exception_list = [{
      type: 'OverdeckTelemetryException',
      value: 'Overdeck browser operation failed',
    }];
  }
  return {
    ...event,
    properties,
    $set: sanitizeBrowserProperties(event.$set),
    $set_once: sanitizeBrowserProperties(event.$set_once),
  };
}

/**
 * PAN-5100: initializes PostHog from a config and client context (desktop
 * `/api/settings` or the phone's `GET /api/telemetry/client-config`). Never
 * throws. Idempotent: a call while already initialized returns `true`
 * without calling `posthog.init` again (React StrictMode runs the phone's
 * mount effect twice).
 */
export function initTelemetryFromConfig(config: TelemetryInitConfig, context: TelemetryClientContext): boolean {
  try {
    if ((config.effectiveEnabled ?? config.enabled) === false) return false;
    if (context.posthogKey === '') return false;
    if (initialized) return true;

    const initOptions: Record<string, unknown> = {
      api_host: context.posthogHost,
      person_profiles: 'identified_only',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      before_send: sanitizePostHogEvent,
      get_current_url: () => 'https://overdeck.invalid/',
      save_campaign_params: false,
      save_referrer: false,
      disable_session_recording: true,
      disable_surveys: true,
    };
    if (context.machineIdentity && config.installId) {
      initOptions.persistence = 'memory';
      initOptions.bootstrap = { distinctID: config.installId };
    }
    posthog.init(context.posthogKey, initOptions);

    posthog.register({ client: context.client, platform: context.platform });
    if (context.appVersion) {
      posthog.register({ app_version: context.appVersion });
    }
    if (config.buildCommit) {
      posthog.register({ build_commit: config.buildCommit });
    }
    if (config.installId) {
      posthog.register({ install_id: config.installId });
    }
    if (config.installKind) {
      posthog.register({ install_kind: config.installKind });
    }
    // PAN-4264: the server sends operatorHash only while operator grouping is
    // on. posthog-js persists super properties (localStorage + cookie), so an
    // opt-out must remove the stored hash, not merely skip registering it.
    if (config.operatorHash) {
      posthog.register({ operatorHash: config.operatorHash });
    } else {
      posthog.unregister('operatorHash');
    }

    currentTelemetryClient = context.client;
    initialized = true;
    return true;
  } catch {
    return false;
  }
}

/** Opt out and stop capturing (D-10). Safe to call when not initialized. */
export function disableTelemetry(): void {
  if (!initialized) return;
  try {
    posthog.opt_out_capturing();
  } catch {
    // Telemetry must never throw.
  }
  initialized = false;
}

export async function initTelemetry(): Promise<void> {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) return;

    const settings = await response.json() as TelemetrySettingsResponse;
    initTelemetryFromConfig(settings.telemetry ?? {}, {
      client: 'desktop',
      platform: 'web',
      posthogKey: import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string,
      posthogHost: import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string,
    });
  } catch {
    // Telemetry must never block dashboard startup.
  }
}

export function capture<Event extends TelemetryEventName>(
  event: Event,
  properties: TelemetryPropertiesFor<Event>,
): void {
  if (!initialized || import.meta.env.MODE === 'test') return;
  posthog.capture(event, properties);
}

export function sanitizeTelemetryException(
  _error: unknown,
  context: TelemetryExceptionContext,
): Error {
  const sanitized = new Error(`Overdeck ${context.action} operation failed`);
  sanitized.name = 'OverdeckTelemetryException';
  sanitized.stack = undefined;
  return sanitized;
}

export function captureException(error: unknown, context: TelemetryExceptionContext): void {
  if (!initialized || import.meta.env.MODE === 'test') return;
  posthog.captureException(sanitizeTelemetryException(error, context), context);
}

export function bucketCount(value: number): TelemetryCountBucket {
  if (value <= 0) return '0';
  if (value <= 2) return '1-2';
  if (value <= 5) return '3-5';
  if (value <= 10) return '6-10';
  return '11+';
}
