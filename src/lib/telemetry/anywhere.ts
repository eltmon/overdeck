/**
 * PAN-5016: Overdeck Anywhere telemetry.
 *
 * Each machine reports only its own side of a machine link, phone pairing,
 * secure-channel outcome and relay use. Every property comes from a closed
 * domain in the telemetry contract: labels, environment ids, token ids, URLs,
 * keys and raw byte counts are never sent. Every capture is wrapped so that a
 * throwing analytics client never changes an Anywhere result (NFR-2), and the
 * opt-out is inherited from `AnalyticsService` (NFR-3).
 */

import {
  bucketRelayBytes,
  type AnywhereChannelOpenedProperties,
  type PhoneRemovedProperties,
  type TelemetryEventName,
  type TelemetryLinkFailureReason,
  type TelemetryLinkMethod,
  type TelemetryLinkSide,
  type TelemetryPropertiesFor,
} from '@overdeck/contracts';
import { getAnalyticsClientTypeForProcess, getAnalyticsService } from './service.js';

export interface AnywhereAnalytics {
  capture<Event extends TelemetryEventName>(event: Event, properties: TelemetryPropertiesFor<Event>): void;
}

export function defaultAnywhereAnalytics(): AnywhereAnalytics {
  return getAnalyticsService(getAnalyticsClientTypeForProcess());
}

function safeCapture<Event extends TelemetryEventName>(
  analytics: AnywhereAnalytics | undefined,
  event: Event,
  properties: TelemetryPropertiesFor<Event>,
): void {
  try {
    (analytics ?? defaultAnywhereAnalytics()).capture(event, properties);
  } catch {
    // Telemetry must never affect an Anywhere operation.
  }
}

export function captureLinkStarted(method: TelemetryLinkMethod, analytics?: AnywhereAnalytics): void {
  safeCapture(analytics, 'machine_link_started', { method });
}

export function captureLinkApproved(method: TelemetryLinkMethod, side: TelemetryLinkSide, analytics?: AnywhereAnalytics): void {
  safeCapture(analytics, 'machine_link_approved', { method, side });
}

export function captureLinkFailed(
  method: TelemetryLinkMethod,
  side: TelemetryLinkSide,
  reason: TelemetryLinkFailureReason,
  analytics?: AnywhereAnalytics,
): void {
  safeCapture(analytics, 'machine_link_failed', { method, side, reason });
}

export function capturePhonePaired(replacedPrevious: boolean, analytics?: AnywhereAnalytics): void {
  safeCapture(analytics, 'phone_paired', { replaced_previous: replacedPrevious });
}

export function capturePhoneRemoved(by: PhoneRemovedProperties['by'], analytics?: AnywhereAnalytics): void {
  safeCapture(analytics, 'phone_removed', { by });
}

export function captureChannelOpen(properties: AnywhereChannelOpenedProperties, analytics?: AnywhereAnalytics): void {
  safeCapture(analytics, 'anywhere_channel_opened', properties);
}

/** D-8: the link method from `createMachineLink`'s input. */
export function linkMethodForTransport(transportKind: string | undefined): TelemetryLinkMethod {
  if (transportKind === undefined) return 'pairing_code';
  if (transportKind === 'ssh') return 'ssh';
  if (transportKind === 'public') return 'fly';
  return 'other';
}

/** MachineLinkError and DirectoryApprovalError codes; matched as strings so this module never imports src/dashboard. */
const LINK_FAILURE_REASONS: Readonly<Record<string, TelemetryLinkFailureReason>> = {
  'bad-pairing-url': 'bad_pairing_url',
  unreachable: 'unreachable',
  'pairing-refused': 'pairing_refused',
  unsupported: 'unsupported',
  'identity-mismatch': 'identity_mismatch',
  'exchange-failed': 'exchange_failed',
  offline: 'offline',
};

/** Maps a MachineLinkError / DirectoryApprovalError `code` (read structurally) to a failure reason. */
export function linkFailureReason(error: unknown): TelemetryLinkFailureReason {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code !== 'string') return 'other';
  return Object.hasOwn(LINK_FAILURE_REASONS, code) ? LINK_FAILURE_REASONS[code]! : 'other';
}

export const RELAY_USAGE_TELEMETRY_INTERVAL_MS = 60 * 60_000;

/**
 * D-5: adds up relayed bytes and sends one bucketed `relay_usage_sampled`
 * once an hour has passed since the window started. Bytes in a window that
 * never sees another relay byte are not sent.
 */
export class RelayUsageSampler {
  private total = 0;
  private windowStart: number | null = null;

  constructor(private readonly opts: { now?: () => number; analytics?: () => AnywhereAnalytics } = {}) {}

  record(bytes: number): void {
    if (!(bytes > 0)) return;
    const now = (this.opts.now ?? Date.now)();
    if (this.windowStart === null) this.windowStart = now;
    this.total += bytes;
    if (now - this.windowStart < RELAY_USAGE_TELEMETRY_INTERVAL_MS) return;
    const bucket = bucketRelayBytes(this.total);
    try {
      (this.opts.analytics ?? defaultAnywhereAnalytics)().capture('relay_usage_sampled', { bytes: bucket });
    } catch {
      // Telemetry must never affect relay metering.
    }
    this.total = 0;
    this.windowStart = now;
  }
}

export const relayUsageSampler = new RelayUsageSampler();
