/**
 * The directory's push decisions as pure functions (PRD PAN-4830 D-1, D-16, NFR-8).
 *
 * It imports only types from directory-state.ts, like ice-relay.ts, so the runtime import graph
 * stays acyclic: directory-state.ts and client-state.ts import values from here, never the reverse.
 * Log effects never carry a push token or a sealed payload.
 */
import { PUSH_RATE_PER_MINUTE } from '../../../packages/contracts/src/connect.ts';
import type { ClientToDirectoryFrame, MachineToDirectoryFrame, PushResultError } from '../../../packages/contracts/src/connect.ts';
import type { ClientRow, DirectoryEffect, DirectoryState, ReduceContext, ReduceResult } from './directory-state.ts';
import type { PushOutcome, PushRegistration } from './push/config.ts';

type PushRegistrationFrame = Extract<ClientToDirectoryFrame, { type: 'push-register' | 'push-unregister' }>;
type PushFrame = Extract<MachineToDirectoryFrame, { type: 'push' }>;

/** One minute of the account's push rate limit (D-8): `minute` is `Math.floor(now / 60_000)`. */
export interface PushWindow {
  readonly minute: number;
  readonly count: number;
}

/** A finished delivery, fed back by the glue after `deliver-push` (D-1). */
export interface PushOutcomeEvent {
  readonly requestId: string;
  readonly clientId: string;
  /** The machine socket's environment id, read after the delivery returned. */
  readonly environmentId: string | null;
  /** The token the delivery used; a dead-token answer clears only this one (D-2). */
  readonly token: string;
  readonly outcome: PushOutcome;
}

function clientLog(type: string, clientId: string, outcome: string): DirectoryEffect {
  return { kind: 'log', type, environmentId: null, outcome, clientId };
}

/** The state with one phone's push registration replaced. */
function withPush(state: DirectoryState, row: ClientRow, push: PushRegistration | null): DirectoryState {
  return { ...state, clients: state.clients.map((c) => (c.clientId === row.clientId ? { ...c, push } : c)) };
}

/**
 * `push-register` stores the phone's token on its row; `push-unregister` clears it (FR-1). A
 * register whose platform differs from the phone's `hello-client` platform is refused (D-7).
 */
export function pushRegistrationAnswer(state: DirectoryState, clientId: string, f: PushRegistrationFrame): ReduceResult {
  const row = state.clients.find((c) => c.clientId === clientId);
  if (!row) return { state, effects: [clientLog(f.type, clientId, 'unknown_client')] };
  if (f.type === 'push-unregister') {
    return {
      state: withPush(state, row, null),
      effects: [{ kind: 'put-client-push', clientId, registration: null }, clientLog(f.type, clientId, 'unregistered')],
    };
  }
  if (f.platform !== row.platform) {
    return {
      state,
      effects: [
        { kind: 'send', to: 'self', frame: { type: 'error', code: 'bad_frame', message: 'push platform does not match the phone' } },
        clientLog(f.type, clientId, 'platform_mismatch'),
      ],
    };
  }
  // D-4: iOS without `apsEnvironment` is a Release build (production); Android has none.
  const registration: PushRegistration = {
    platform: f.platform,
    token: f.token,
    apsEnvironment: f.platform === 'ios' ? (f.apsEnvironment ?? 'production') : null,
  };
  return {
    state: withPush(state, row, registration),
    effects: [{ kind: 'put-client-push', clientId, registration }, clientLog(f.type, clientId, 'registered')],
  };
}

/** `push-result` to the machine that sent the push. */
function pushResult(requestId: string, error?: PushResultError): DirectoryEffect {
  return {
    kind: 'send',
    to: 'self',
    frame: error === undefined ? { type: 'push-result', requestId, ok: true } : { type: 'push-result', requestId, ok: false, error },
  };
}

function pushLog(environmentId: string | null, clientId: string, outcome: string): DirectoryEffect {
  return { kind: 'log', type: 'push', environmentId, outcome, clientId };
}

/**
 * A machine's `push` (FR-2, FR-3): the phone must be this account's and have a registration, and
 * the account must be under `PUSH_RATE_PER_MINUTE` this UTC minute. Presence is never read (D-3):
 * a closed app is the reason push exists. Only a push that passes counts toward the limit.
 */
export function pushAnswer(state: DirectoryState, f: PushFrame, ctx: ReduceContext, self: string): ReduceResult {
  const row = state.clients.find((c) => c.clientId === f.to);
  if (!row) return { state, effects: [pushResult(f.requestId, 'unknown_client'), pushLog(self, f.to, 'unknown_client')] };
  if (row.push === null) return { state, effects: [pushResult(f.requestId, 'no_registration'), pushLog(self, f.to, 'no_registration')] };
  const minute = Math.floor(ctx.now / 60_000);
  const count = state.pushWindow?.minute === minute ? state.pushWindow.count : 0;
  if (count >= PUSH_RATE_PER_MINUTE) return { state, effects: [pushResult(f.requestId, 'rate_limited'), pushLog(self, f.to, 'rate_limited')] };
  const window: PushWindow = { minute, count: count + 1 };
  return {
    state: { ...state, pushWindow: window },
    effects: [
      { kind: 'put-push-window', window },
      {
        kind: 'deliver-push',
        requestId: f.requestId,
        clientId: f.to,
        registration: row.push,
        sealed: f.sealed,
        urgency: f.urgency,
        collapseId: f.collapseId,
      },
    ],
  };
}

/**
 * The answer once delivery returns (FR-8, FR-10, D-13). It reduces against the state current after
 * the delivery's await, so a phone that re-registered meanwhile keeps its new token (D-2).
 */
export function reducePushOutcome(state: DirectoryState, event: PushOutcomeEvent): ReduceResult {
  const { requestId, clientId, environmentId, outcome } = event;
  switch (outcome.kind) {
    case 'delivered':
      return { state, effects: [pushResult(requestId), pushLog(environmentId, clientId, 'delivered')] };
    case 'gone': {
      const answer = [pushResult(requestId, 'no_registration'), pushLog(environmentId, clientId, 'gone')];
      const row = state.clients.find((c) => c.clientId === clientId);
      if (row?.push?.token !== event.token) return { state, effects: answer };
      return { state: withPush(state, row, null), effects: [{ kind: 'put-client-push', clientId, registration: null }, ...answer] };
    }
    case 'failed':
      return { state, effects: [pushResult(requestId, 'delivery_failed'), pushLog(environmentId, clientId, `failed_${outcome.detail}`)] };
    case 'not_configured':
      return { state, effects: [pushResult(requestId, 'delivery_failed'), pushLog(environmentId, clientId, 'not_configured')] };
  }
}
