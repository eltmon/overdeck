import posthog from 'posthog-js';
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
  | 'frontend_recovery_reload_loop';

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

export async function initTelemetry(): Promise<void> {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) return;

    const settings = await response.json() as TelemetrySettingsResponse;
    if (settings.telemetry?.enabled === false) return;

    posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string, {
      api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string,
      person_profiles: 'identified_only',
      capture_exceptions: true,
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

export function captureException(error: unknown, context: TelemetryExceptionContext): void {
  if (!initialized || import.meta.env.MODE === 'test') return;
  posthog.captureException(error, context);
}

export function bucketCount(value: number): TelemetryCountBucket {
  if (value <= 0) return '0';
  if (value <= 2) return '1-2';
  if (value <= 5) return '3-5';
  if (value <= 10) return '6-10';
  return '11+';
}
