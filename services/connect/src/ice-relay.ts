/**
 * The `ice-servers` and `relay-usage` answers, shared by the machine reducer (directory-state.ts)
 * and the phone reducer (client-state.ts) per PAN-4829 D-9. It imports only types from
 * directory-state.ts, so the runtime import graph stays acyclic and directory-state.ts stays
 * under the 600-line module limit (PAN-4829 NFR-5).
 */
import { RELAY_CAP_MESSAGE } from '../../../packages/contracts/src/connect.ts';
import type { ConnectErrorCode } from '../../../packages/contracts/src/connect.ts';
import type { DirectoryEffect, DirectoryState, ReduceContext, ReduceResult } from './directory-state.ts';
import { addUsage, bytesThisMonth, relayStatusOf } from './relay-meter.ts';

/** Who a `log` effect names: a machine's environment id, or a phone's client id with a null environment. */
export interface LogSubject {
  readonly environmentId: string | null;
  readonly clientId?: string;
}

/**
 * The answer to `ice-servers`, shared by machines and phones (PAN-4829 D-9). For `relay: true`,
 * D-2356-12 orders the checks: plan, then cap, then TURN configured.
 */
export function iceServersAnswer(
  state: DirectoryState,
  f: { readonly requestId: string; readonly relay: boolean },
  ctx: ReduceContext,
  subject: LogSubject,
): ReduceResult {
  const type = 'ice-servers';
  if (f.relay) {
    const ids = { requestId: f.requestId };
    const refuse = (code: ConnectErrorCode, message: string): ReduceResult => ({
      state,
      effects: [
        { kind: 'send', to: 'self', frame: { type: 'error', code, message, ...ids } },
        { kind: 'log', type, ...subject, outcome: code },
      ],
    });
    if (state.plan !== 'tester') return refuse('relay_not_allowed', 'the relay needs the relay plan');
    if (bytesThisMonth(state.relay, ctx.now) >= ctx.relayCapBytes) return refuse('relay_cap_reached', RELAY_CAP_MESSAGE);
    if (!ctx.turnConfigured) return refuse('turn_unavailable', 'relay credentials are not available');
    return {
      state,
      effects: [
        { kind: 'fetch-turn', requestId: f.requestId },
        { kind: 'log', type, ...subject, outcome: 'turn' },
      ],
    };
  }
  const iceServers = ctx.stunUrls.length > 0 ? [{ urls: [...ctx.stunUrls] }] : [];
  return {
    state,
    effects: [
      { kind: 'send', to: 'self', frame: { type, requestId: f.requestId, iceServers } },
      { kind: 'log', type, ...subject, outcome: 'stun' },
    ],
  };
}

/** Meters a `relay-usage` report against the account, from a machine or a phone (PAN-4829 D-9). */
export function relayUsageAnswer(state: DirectoryState, bytes: number, ctx: ReduceContext, subject: LogSubject): ReduceResult {
  const { usage, reachedCap } = addUsage(state.relay, bytes, ctx.now, ctx.relayCapBytes);
  const next: DirectoryState = { ...state, relay: usage };
  const effects: DirectoryEffect[] = [{ kind: 'put-relay-usage', usage }];
  const status = relayStatusOf(usage, ctx.now, ctx.relayCapBytes);
  if (reachedCap || !status.stopped) {
    // Every machine's status card shows the month's traffic, so each report refreshes it. At the
    // cap every machine closes its relay channels (no new credentials until the next month);
    // later reports in a stopped month send nothing, since the stop was already broadcast.
    // Phones see the same status (PAN-4829 FR-8).
    const frame = { type: 'relay-status', ...status } as const;
    effects.push({ kind: 'send', to: 'all', frame }, { kind: 'send', to: 'clients', frame });
  }
  effects.push({ kind: 'log', type: 'relay-usage', ...subject, outcome: reachedCap ? 'cap_reached' : 'counted' });
  return { state: next, effects };
}
