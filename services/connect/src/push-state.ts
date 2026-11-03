/**
 * The directory's push decisions as pure functions (PRD PAN-4830 D-1, D-16, NFR-8).
 *
 * It imports only types from directory-state.ts, like ice-relay.ts, so the runtime import graph
 * stays acyclic: directory-state.ts and client-state.ts import values from here, never the reverse.
 * Log effects never carry a push token or a sealed payload.
 */
import type { ClientToDirectoryFrame } from '../../../packages/contracts/src/connect.ts';
import type { ClientRow, DirectoryEffect, DirectoryState, ReduceResult } from './directory-state.ts';
import type { PushRegistration } from './push/config.ts';

type PushRegistrationFrame = Extract<ClientToDirectoryFrame, { type: 'push-register' | 'push-unregister' }>;

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
