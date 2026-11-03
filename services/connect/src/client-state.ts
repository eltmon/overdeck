/**
 * The directory's rules for phone clients as a pure reducer (PAN-4829, PAN-4823 W-CON2).
 *
 * A phone registers with `hello-client` and never counts as a machine: its row lives in
 * `state.clients`, capped at `CLIENT_LIMIT` on every plan, and it never touches `state.machines`.
 * This module imports from directory-state.ts and is never imported by it (PAN-4829 D-5), so the
 * graph stays acyclic. The Durable Object glue picks this reducer for client events.
 */
import {
  CLIENT_LIMIT,
  CLIENT_LIMIT_MESSAGE,
  CONNECT_CLOSE_CODES,
  CONNECT_PROTOCOL_VERSION,
} from '../../../packages/contracts/src/connect.ts';
import type { ClientToDirectoryFrame } from '../../../packages/contracts/src/connect.ts';
import { errorFrame, onlineClientsOf, toDirectoryMachines } from './directory-state.ts';
import type { ClientRow, DirectoryEffect, DirectoryState, ReduceContext, ReduceResult, SocketIdentity } from './directory-state.ts';
import { activityRegistrationAnswer, withoutClientReports } from './activity-state.ts';
import { iceServersAnswer, relayUsageAnswer } from './ice-relay.ts';
import { pushRegistrationAnswer } from './push-state.ts';

type HelloClientFrame = Extract<ClientToDirectoryFrame, { type: 'hello-client' }>;
type LaterClientFrame = Exclude<ClientToDirectoryFrame, { type: 'hello-client' }>;

/** `registeredAs` is the client id the event's own socket is bound to, or null before its `hello-client`. */
export type ClientEvent =
  | { readonly kind: 'hello-client'; readonly registeredAs: string | null; readonly identity: SocketIdentity; readonly frame: HelloClientFrame }
  | { readonly kind: 'client-frame'; readonly clientId: string; readonly frame: LaterClientFrame }
  | { readonly kind: 'client-bad-frame'; readonly clientId: string; readonly reason: 'bad_frame' | 'unsupported' }
  | { readonly kind: 'client-gone'; readonly clientId: string };

/** A log effect for a phone event: never an environment id, never a label or key. */
function log(type: string, clientId: string, outcome: string): DirectoryEffect {
  return { kind: 'log', type, environmentId: null, outcome, clientId };
}

function replaceClient(clients: readonly ClientRow[], row: ClientRow): ClientRow[] {
  const index = clients.findIndex((c) => c.clientId === row.clientId);
  if (index === -1) return [...clients, row];
  return clients.map((c, i) => (i === index ? row : c));
}

function helloClient(state: DirectoryState, event: Extract<ClientEvent, { kind: 'hello-client' }>, ctx: ReduceContext): ReduceResult {
  const { frame, identity } = event;
  const clientId = frame.clientId;
  if (event.registeredAs !== null) {
    return {
      state,
      effects: [
        { kind: 'send', to: 'self', frame: errorFrame('bad_frame', 'hello was already sent on this socket') },
        log(frame.type, event.registeredAs, 'repeated'),
      ],
    };
  }

  const effects: DirectoryEffect[] = [];
  // D-10: a phone's hello refreshes the plan too, so its relay check sees the current plan.
  const planned: DirectoryState = state.plan === identity.plan ? state : { ...state, plan: identity.plan };
  if (planned !== state) effects.push({ kind: 'put-plan', plan: identity.plan });

  const existing = state.clients.find((c) => c.clientId === clientId);
  if (!existing && state.clients.length >= CLIENT_LIMIT) {
    effects.push(
      { kind: 'send', to: 'self', frame: errorFrame('client_limit', CLIENT_LIMIT_MESSAGE) },
      { kind: 'close', to: 'self', code: CONNECT_CLOSE_CODES.clientLimit, reason: 'client limit' },
      log(frame.type, clientId, 'client_limit'),
    );
    return { state: planned, effects };
  }

  const row: ClientRow = {
    clientId,
    label: frame.label,
    publicKeyHex: frame.publicKeyHex,
    platform: frame.platform,
    appVersion: frame.appVersion,
    deviceId: identity.deviceId,
    registeredAt: existing?.registeredAt ?? ctx.now,
    lastSeenAt: ctx.now,
    // A re-hello keeps the push registration; only push-register and push-unregister change it.
    push: existing?.push ?? null,
    activity: existing?.activity ?? null,
  };
  const next: DirectoryState = { ...planned, clients: replaceClient(planned.clients, row) };
  effects.push({ kind: 'put-client', row });
  if (onlineClientsOf(ctx).has(clientId)) {
    effects.push({ kind: 'close', to: { clientId }, code: CONNECT_CLOSE_CODES.replaced, reason: 'replaced' });
  }
  effects.push(
    { kind: 'register-client', clientId },
    {
      kind: 'send',
      to: 'self',
      frame: {
        type: 'welcome-client',
        protocol: CONNECT_PROTOCOL_VERSION,
        plan: identity.plan,
        relayAllowed: identity.plan !== 'free',
        machines: toDirectoryMachines(next.machines, ctx.online),
      },
    },
    log(frame.type, clientId, existing ? 'updated' : 'registered'),
  );
  return { state: next, effects };
}

function clientFrame(state: DirectoryState, event: Extract<ClientEvent, { kind: 'client-frame' }>, ctx: ReduceContext): ReduceResult {
  const { clientId, frame: f } = event;
  switch (f.type) {
    case 'forget-client': {
      const forgotten = { kind: 'close', to: 'self', code: CONNECT_CLOSE_CODES.forgotten, reason: 'forgotten' } as const;
      if (!state.clients.some((c) => c.clientId === clientId)) {
        return { state, effects: [forgotten, log(f.type, clientId, 'unknown_client')] };
      }
      return {
        state: { ...state, clients: state.clients.filter((c) => c.clientId !== clientId), activityReports: withoutClientReports(state, clientId) },
        effects: [{ kind: 'delete-client', clientId }, forgotten, log(f.type, clientId, 'ok')],
      };
    }
    case 'signal': {
      const session = { session: f.session };
      if (state.clients.some((c) => c.clientId === f.to)) {
        return {
          state,
          effects: [
            { kind: 'send', to: 'self', frame: errorFrame('bad_frame', 'a phone cannot signal a phone', session) },
            log(f.type, clientId, 'client_to_client'),
          ],
        };
      }
      if (!ctx.online.has(f.to)) {
        return {
          state,
          effects: [
            { kind: 'send', to: 'self', frame: errorFrame('peer_offline', 'the machine is offline', session) },
            log(f.type, clientId, 'peer_offline'),
          ],
        };
      }
      return {
        state,
        effects: [
          {
            kind: 'send',
            to: { environmentId: f.to },
            // `from` is the sender socket's client id, never a field of the frame (D-2356-6).
            frame: { type: 'signal', from: clientId, session: f.session, purpose: 'link', relay: f.relay, data: f.data },
          },
          log(f.type, clientId, 'forwarded'),
        ],
      };
    }
    case 'ice-servers':
      return iceServersAnswer(state, f, ctx, { environmentId: null, clientId });
    case 'relay-usage':
      return relayUsageAnswer(state, f.bytes, ctx, { environmentId: null, clientId });
    case 'push-register':
    case 'push-unregister':
      return pushRegistrationAnswer(state, clientId, f);
    case 'activity-register':
    case 'activity-unregister':
      return activityRegistrationAnswer(state, clientId, f, ctx);
  }
}

export function reduceClient(state: DirectoryState, event: ClientEvent, ctx: ReduceContext): ReduceResult {
  switch (event.kind) {
    case 'hello-client':
      return helloClient(state, event, ctx);
    case 'client-frame':
      return clientFrame(state, event, ctx);
    case 'client-bad-frame': {
      if (event.reason === 'unsupported') {
        return {
          state,
          effects: [
            { kind: 'send', to: 'self', frame: errorFrame('unsupported', 'unsupported directory protocol') },
            { kind: 'close', to: 'self', code: CONNECT_CLOSE_CODES.unsupportedProtocol, reason: event.reason },
            log('unknown', event.clientId, event.reason),
          ],
        };
      }
      return {
        state,
        effects: [{ kind: 'send', to: 'self', frame: errorFrame('bad_frame', 'malformed frame') }, log('unknown', event.clientId, event.reason)],
      };
    }
    case 'client-gone': {
      const row = state.clients.find((c) => c.clientId === event.clientId);
      if (!row) return { state, effects: [] };
      const updated: ClientRow = { ...row, lastSeenAt: ctx.now };
      return {
        state: { ...state, clients: replaceClient(state.clients, updated) },
        effects: [{ kind: 'put-client', row: updated }, log('close', event.clientId, 'offline')],
      };
    }
  }
}
