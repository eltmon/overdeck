import posthog, { type CaptureResult, type Properties } from 'posthog-js';
import type {
  TelemetryCountBucket,
  TelemetryEventName,
  TelemetryPropertiesFor,
} from '@overdeck/contracts';

interface TelemetrySettingsResponse {
  telemetry?: {
    enabled?: boolean;
    installId?: string;
  };
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

export async function initTelemetry(): Promise<void> {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) return;

    const settings = await response.json() as TelemetrySettingsResponse;
    if (settings.telemetry?.enabled === false) return;

    posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string, {
      api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string,
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
    });
    if (settings.telemetry?.installId) {
      posthog.register({ install_id: settings.telemetry.installId });
    }
    initialized = true;
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
