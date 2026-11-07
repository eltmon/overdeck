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

/** True once `posthog.init` has run on this page. */
let loaded = false;
/** Capturing is allowed only when `'on'` (PAN-5100 WI-4b). */
let consent: 'unknown' | 'on' | 'off' = 'unknown';
let loadedIdentity: { installId?: string; key: string; host: string } | null = null;
let currentTelemetryClient: TelemetryClient | null = null;

/** PAN-5100: a captureException before init queues here, flushed on the first "on" answer. */
export const PENDING_EXCEPTION_LIMIT = 5;
const pendingExceptions: Array<{ error: unknown; context: TelemetryExceptionContext }> = [];

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

/** PAN-5100 WI-4b: the D-5 super properties, re-registered on every "on" answer. */
function registerSuperProperties(config: TelemetryInitConfig, context: TelemetryClientContext): void {
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
}

function identitiesMatch(
  a: { installId?: string; key: string; host: string },
  b: { installId?: string; key: string; host: string },
): boolean {
  return a.installId === b.installId && a.key === b.key && a.host === b.host;
}

function sendCapturedException(error: unknown, context: TelemetryExceptionContext): void {
  try {
    posthog.captureException(sanitizeTelemetryException(error, context), context);
  } catch {
    // Telemetry must never throw.
  }
}

/** PAN-5100 WI-4b: sends every queued pre-init exception once, then empties the queue. */
function flushPendingExceptions(): void {
  const entries = pendingExceptions.splice(0, pendingExceptions.length);
  for (const { error, context } of entries) {
    sendCapturedException(error, context);
  }
}

/**
 * PAN-5100: initializes PostHog from a config and client context (desktop
 * `/api/settings` or the phone's `GET /api/telemetry/client-config`). Never
 * throws. Idempotent: a call while already loaded does not call
 * `posthog.init` again (React StrictMode runs the phone's mount effect
 * twice) — it re-opts-in and re-registers the super properties instead
 * (WI-4b step 1). When the config's installId, key or host differs from
 * the identity PostHog was loaded with, the SDK cannot switch identity in
 * place, so the door opts out and returns false (WI-4b step 5).
 */
export function initTelemetryFromConfig(config: TelemetryInitConfig, context: TelemetryClientContext): boolean {
  try {
    if ((config.effectiveEnabled ?? config.enabled) === false) {
      consent = 'off';
      pendingExceptions.length = 0;
      return false;
    }
    if (context.posthogKey === '') return false;

    const identity = { installId: config.installId, key: context.posthogKey, host: context.posthogHost };

    if (loaded) {
      if (loadedIdentity && !identitiesMatch(loadedIdentity, identity)) {
        posthog.opt_out_capturing();
        consent = 'off';
        return false;
      }
      posthog.opt_in_capturing({ captureEventName: false });
      registerSuperProperties(config, context);
      currentTelemetryClient = context.client;
      consent = 'on';
      flushPendingExceptions();
      return true;
    }

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
    loaded = true;
    loadedIdentity = identity;

    // A denial stored by an earlier page persists across init; the machine's
    // current answer is the authority on every boot.
    if (posthog.has_opted_out_capturing()) {
      posthog.opt_in_capturing({ captureEventName: false });
    }

    registerSuperProperties(config, context);
    currentTelemetryClient = context.client;
    consent = 'on';
    flushPendingExceptions();
    return true;
  } catch {
    return false;
  }
}

/** Opt out and stop capturing (D-10). Safe to call when not loaded. */
export function disableTelemetry(): void {
  if (loaded) {
    try {
      posthog.opt_out_capturing();
    } catch {
      // Telemetry must never throw.
    }
  }
  consent = 'off';
  pendingExceptions.length = 0;
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
  if (consent !== 'on' || import.meta.env.MODE === 'test') return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Telemetry must never throw.
  }
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

/**
 * PAN-5100 WI-4b: before consent is known, queues the exception (up to
 * `PENDING_EXCEPTION_LIMIT`) so a crash that happens before boot finishes
 * is not lost; flushed once consent turns "on", emptied without sending
 * once it turns "off". While consent is already "off", the exception is
 * dropped, never queued.
 */
export function captureException(error: unknown, context: TelemetryExceptionContext): void {
  if (import.meta.env.MODE === 'test') return;
  if (consent === 'on') {
    sendCapturedException(error, context);
    return;
  }
  if (consent === 'unknown' && pendingExceptions.length < PENDING_EXCEPTION_LIMIT) {
    pendingExceptions.push({ error, context });
  }
}

export function bucketCount(value: number): TelemetryCountBucket {
  if (value <= 0) return '0';
  if (value <= 2) return '1-2';
  if (value <= 5) return '3-5';
  if (value <= 10) return '6-10';
  return '11+';
}
