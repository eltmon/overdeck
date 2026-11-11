/**
 * PAN-5100 D-14/D-15: reports `phone_link_state` for a dial failure, a drop (the connection phase
 * leaving `live`), a recovery back to `live`, and a route change on the phone's link to the open
 * machine. The connection is shared with notification-preference sync, which opens links to every
 * paired machine, so only the currently open machine's events are ever reported (D-15 "current
 * machine only").
 */
import { ChannelOpenError } from '@overdeck/anywhere-channel/web';
import {
  bucketRecoveryMs,
  type PhoneLinkStateProperties,
  type TelemetryLinkReason,
  type TelemetryLinkRoute,
} from '@overdeck/contracts';
import type { ConnectionPhase } from '../../../../src/dashboard/frontend/src/lib/connectionState';
import { capture } from '../../../../src/dashboard/frontend/src/lib/telemetry';
import { ConnectionError } from './connection';

export const LINK_FAILURE_THROTTLE_MS = 60_000;
export const RESUME_DROP_WINDOW_MS = 5_000;

export interface LinkTelemetryDeps {
  /** `currentMachineId` from `./store`. */
  currentEnvironmentId: () => string | null;
  /** `onSessionChange` from `./session`. */
  onSessionChange: (listener: () => void) => () => void;
  /** `lastDialError` from `./session`. */
  lastDialError: () => ConnectionError | null;
  subscribePhase: (listener: (phase: ConnectionPhase) => void) => () => void;
  currentPhase: () => ConnectionPhase;
  /** `lastResumedAt` from `./lifecycle`. */
  lastResumedAt: () => number | null;
  /** Default: `capture('phone_link_state', properties)`. */
  report?: (properties: PhoneLinkStateProperties) => void;
  /** Default: `Date.now`. */
  now?: () => number;
}

export interface LinkTelemetry {
  /** Reports a route change for the environment id that just opened a link (WI-9a's `onLinkOpened`). */
  routeOpened(environmentId: string, route: 'direct' | 'relay'): void;
  uninstall(): void;
}

/** PAN-5100: maps a failed dial's `ConnectionError` to the closed `link_reason` domain. */
export function linkReasonOf(error: ConnectionError): TelemetryLinkReason {
  switch (error.kind) {
    case 'directory-offline':
      return 'offline';
    case 'no-path':
      return 'no_path';
    case 'removed':
      return 'removed';
    case 'pairing-refused':
      return 'pairing_refused';
    case 'identity':
      return 'identity_mismatch';
    case 'outdated':
      return 'unsupported';
    case 'other':
      return error.cause instanceof ChannelOpenError ? 'channel_failed' : 'other';
    default:
      return 'other';
  }
}

const DROP_REASONS: ReadonlySet<ConnectionPhase> = new Set(['delayed', 'unreachable', 'restarting', 'unauthorized']);

export function installLinkTelemetry(deps: LinkTelemetryDeps): LinkTelemetry {
  const now = deps.now ?? Date.now;
  const report = deps.report ?? ((properties: PhoneLinkStateProperties) => capture('phone_link_state', properties));

  function send(properties: PhoneLinkStateProperties): void {
    try {
      report(properties);
    } catch {
      // Telemetry must never break the link.
    }
  }

  // routeOpened state, kept only for the currently open machine (D-15).
  const routesByMachine = new Map<string, TelemetryLinkRoute>();

  function routeOpened(environmentId: string, route: 'direct' | 'relay'): void {
    if (environmentId !== deps.currentEnvironmentId()) return;
    const previous = routesByMachine.get(environmentId);
    routesByMachine.set(environmentId, route);
    if (previous !== undefined && previous !== route) {
      send({ state: 'route_changed', reason: 'none', route, recover_time: 'none' });
    }
  }

  function currentRoute(): TelemetryLinkRoute {
    const id = deps.currentEnvironmentId();
    return (id !== null ? routesByMachine.get(id) : undefined) ?? 'unknown';
  }

  // "failed": a dial failure, at most once per reason per LINK_FAILURE_THROTTLE_MS.
  let lastReportedError: ConnectionError | null = null;
  const failureLastSentAt = new Map<TelemetryLinkReason, number>();

  const unsubscribeSession = deps.onSessionChange(() => {
    const error = deps.lastDialError();
    if (error === null || error === lastReportedError) return;
    lastReportedError = error;
    const reason = linkReasonOf(error);
    const timestamp = now();
    const lastSentAt = failureLastSentAt.get(reason);
    if (lastSentAt !== undefined && timestamp - lastSentAt < LINK_FAILURE_THROTTLE_MS) return;
    failureLastSentAt.set(reason, timestamp);
    send({ state: 'failed', reason, route: 'unknown', recover_time: 'none' });
  });

  // "dropped" / "recovered": the connection phase leaving and returning to `live`.
  let previousPhase: ConnectionPhase = deps.currentPhase();
  let dropAt: number | null = null;
  let dropReason: TelemetryLinkReason | null = null;

  const unsubscribePhase = deps.subscribePhase((phase) => {
    if (deps.currentEnvironmentId() === null) {
      // No machine is open (PAN-5100 D-15): never report a drop/recovery for it.
      previousPhase = phase;
      dropAt = null;
      dropReason = null;
      return;
    }
    const timestamp = now();
    if (previousPhase === 'live' && phase !== 'live' && DROP_REASONS.has(phase)) {
      const resumedAt = deps.lastResumedAt();
      const reason: TelemetryLinkReason = resumedAt !== null && timestamp - resumedAt <= RESUME_DROP_WINDOW_MS ? 'resume' : phase;
      dropAt = timestamp;
      dropReason = reason;
      send({ state: 'dropped', reason, route: currentRoute(), recover_time: 'none' });
    } else if (phase === 'live' && previousPhase !== 'live' && dropAt !== null) {
      send({
        state: 'recovered',
        reason: dropReason ?? 'other',
        route: currentRoute(),
        recover_time: bucketRecoveryMs(timestamp - dropAt),
      });
      dropAt = null;
      dropReason = null;
    }
    previousPhase = phase;
  });

  return {
    routeOpened,
    uninstall() {
      unsubscribeSession();
      unsubscribePhase();
    },
  };
}
