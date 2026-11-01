/**
 * The account directory's rules as a pure reducer (PRD PAN-2356 WI-5, D-2356-4), following the
 * share service's room-state.ts: `reduce(state, event, ctx) → { state, effects }`.
 *
 * The Durable Object glue (directory.ts) owns sockets and SQL storage. It hands the reducer the
 * current registry, the event and which machines are online, then runs the effects: persistence
 * first, then socket registration, then sends, then closes. The reducer never mutates its input.
 */
import {
  CONNECT_CLOSE_CODES,
  CONNECT_PROTOCOL_VERSION,
  FREE_MACHINE_LIMIT_MESSAGE,
  RELAY_MONTHLY_CAP_BYTES,
} from '../../../packages/contracts/src/connect.ts';
import type {
  ConnectErrorCode,
  ConnectPlan,
  DirectoryEndpoint,
  DirectoryMachine,
  DirectoryToMachineFrame,
  MachineToDirectoryFrame,
  RelayStatus,
} from '../../../packages/contracts/src/connect.ts';

/** One registered machine: a row of the `machines` table. */
export interface MachineRow {
  readonly environmentId: string;
  readonly label: string;
  readonly publicKeyHex: string;
  readonly fingerprint: string;
  readonly endpoints: readonly DirectoryEndpoint[];
  readonly serverVersion: string;
  readonly deviceId: string;
  /** Unix milliseconds. */
  readonly registeredAt: number;
  /** Unix milliseconds. */
  readonly lastSeenAt: number;
}

export interface DirectoryState {
  /** The account plan last seen on a `hello`; null before the first one. */
  readonly plan: ConnectPlan | null;
  /** In registration order. */
  readonly machines: readonly MachineRow[];
}

/** What the Worker verified about the device behind a socket (from `X-Connect-Identity`). */
export interface SocketIdentity {
  readonly deviceId: string;
  readonly plan: ConnectPlan;
  readonly maxDevices: number | null;
}

type HelloFrame = Extract<MachineToDirectoryFrame, { type: 'hello' }>;
type LaterFrame = Exclude<MachineToDirectoryFrame, { type: 'hello' }>;

/**
 * `registeredAs` is the environment id the event's own socket is bound to, or null before its
 * `hello`. `fingerprint` on a hello is computed by the glue with WebCrypto.
 */
export type DirectoryEvent =
  | { readonly kind: 'hello'; readonly registeredAs: string | null; readonly identity: SocketIdentity; readonly frame: HelloFrame; readonly fingerprint: string }
  | { readonly kind: 'frame'; readonly registeredAs: string | null; readonly frame: LaterFrame }
  | { readonly kind: 'bad-frame'; readonly registeredAs: string | null; readonly reason: 'bad_frame' | 'unsupported' }
  | { readonly kind: 'socket-gone'; readonly registeredAs: string };

export interface ReduceContext {
  /** Unix milliseconds. */
  readonly now: number;
  /** Environment ids with an open registered socket, not counting the event's own socket. */
  readonly online: ReadonlySet<string>;
}

/**
 * Socket targets. `self` is the event's socket; `others` is every registered socket except it;
 * `{ environmentId }` is that machine's registered sockets except the event's own.
 */
export type Target = 'self' | 'others' | { readonly environmentId: string };

export type DirectoryEffect =
  | { readonly kind: 'put-plan'; readonly plan: ConnectPlan }
  | { readonly kind: 'put-machine'; readonly row: MachineRow }
  | { readonly kind: 'delete-machine'; readonly environmentId: string }
  | { readonly kind: 'register'; readonly environmentId: string }
  | { readonly kind: 'send'; readonly to: Target; readonly frame: DirectoryToMachineFrame }
  | { readonly kind: 'close'; readonly to: Target; readonly code: number; readonly reason: string }
  | { readonly kind: 'log'; readonly type: string; readonly environmentId: string | null; readonly outcome: string };

export interface ReduceResult {
  readonly state: DirectoryState;
  readonly effects: DirectoryEffect[];
}

export const EMPTY_DIRECTORY: DirectoryState = { plan: null, machines: [] };

/** UTC calendar month of `now`, `YYYY-MM`. */
export function monthOf(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

export function relayStatus(now: number): RelayStatus {
  return { month: monthOf(now), bytesUsed: 0, capBytes: RELAY_MONTHLY_CAP_BYTES, stopped: false };
}

export function toDirectoryMachines(machines: readonly MachineRow[], online: ReadonlySet<string>): DirectoryMachine[] {
  return machines.map((row) => ({
    environmentId: row.environmentId,
    label: row.label,
    publicKeyHex: row.publicKeyHex,
    fingerprint: row.fingerprint,
    online: online.has(row.environmentId),
    lastSeenAt: new Date(row.lastSeenAt).toISOString(),
    serverVersion: row.serverVersion,
    endpoints: row.endpoints,
  }));
}

function errorFrame(code: ConnectErrorCode, message: string): DirectoryToMachineFrame {
  return { type: 'error', code, message };
}

function withOnline(online: ReadonlySet<string>, add: string | null, remove: string | null = null): Set<string> {
  const out = new Set(online);
  if (add !== null) out.add(add);
  if (remove !== null) out.delete(remove);
  return out;
}

function replaceRow(machines: readonly MachineRow[], row: MachineRow): MachineRow[] {
  const index = machines.findIndex((m) => m.environmentId === row.environmentId);
  if (index === -1) return [...machines, row];
  return machines.map((m, i) => (i === index ? row : m));
}

function hello(state: DirectoryState, event: Extract<DirectoryEvent, { kind: 'hello' }>, ctx: ReduceContext): ReduceResult {
  const { frame, identity } = event;
  const env = frame.environmentId;
  if (event.registeredAs !== null) {
    return {
      state,
      effects: [
        { kind: 'send', to: 'self', frame: errorFrame('bad_frame', 'hello was already sent on this socket') },
        { kind: 'log', type: 'hello', environmentId: event.registeredAs, outcome: 'repeated' },
      ],
    };
  }

  const effects: DirectoryEffect[] = [];
  const planned: DirectoryState = state.plan === identity.plan ? state : { ...state, plan: identity.plan };
  if (planned !== state) effects.push({ kind: 'put-plan', plan: identity.plan });

  const existing = state.machines.find((m) => m.environmentId === env);
  if (!existing && identity.maxDevices !== null && state.machines.length >= identity.maxDevices) {
    effects.push(
      { kind: 'send', to: 'self', frame: errorFrame('machine_limit', FREE_MACHINE_LIMIT_MESSAGE) },
      { kind: 'close', to: 'self', code: CONNECT_CLOSE_CODES.machineLimit, reason: 'machine limit' },
      { kind: 'log', type: 'hello', environmentId: env, outcome: 'machine_limit' },
    );
    return { state: planned, effects };
  }

  const row: MachineRow = {
    environmentId: env,
    label: frame.label,
    publicKeyHex: frame.publicKeyHex,
    fingerprint: event.fingerprint,
    endpoints: frame.endpoints,
    serverVersion: frame.serverVersion,
    deviceId: identity.deviceId,
    registeredAt: existing?.registeredAt ?? ctx.now,
    lastSeenAt: ctx.now,
  };
  const next: DirectoryState = { ...planned, machines: replaceRow(planned.machines, row) };
  const machines = toDirectoryMachines(next.machines, withOnline(ctx.online, env));
  const plan = identity.plan;
  effects.push({ kind: 'put-machine', row });
  if (ctx.online.has(env)) {
    effects.push({ kind: 'close', to: { environmentId: env }, code: CONNECT_CLOSE_CODES.replaced, reason: 'replaced' });
  }
  effects.push(
    { kind: 'register', environmentId: env },
    {
      kind: 'send',
      to: 'self',
      frame: {
        type: 'welcome',
        protocol: CONNECT_PROTOCOL_VERSION,
        plan,
        maxMachines: identity.maxDevices,
        relayAllowed: plan !== 'free',
        inboxAllowed: plan !== 'free',
        relay: relayStatus(ctx.now),
        machines,
      },
    },
    { kind: 'send', to: 'others', frame: { type: 'directory', machines } },
    { kind: 'log', type: 'hello', environmentId: env, outcome: existing ? 'updated' : 'registered' },
  );
  return { state: next, effects };
}

function frame(state: DirectoryState, event: Extract<DirectoryEvent, { kind: 'frame' }>, ctx: ReduceContext): ReduceResult {
  const self = event.registeredAs;
  const { frame: f } = event;
  if (self === null) {
    return {
      state,
      effects: [
        { kind: 'close', to: 'self', code: CONNECT_CLOSE_CODES.unsupportedProtocol, reason: 'hello required' },
        { kind: 'log', type: f.type, environmentId: null, outcome: 'before_hello' },
      ],
    };
  }

  switch (f.type) {
    case 'endpoints': {
      const row = state.machines.find((m) => m.environmentId === self);
      if (!row) return { state, effects: [{ kind: 'log', type: f.type, environmentId: self, outcome: 'unknown_machine' }] };
      const updated: MachineRow = { ...row, endpoints: f.endpoints };
      const next: DirectoryState = { ...state, machines: replaceRow(state.machines, updated) };
      return {
        state: next,
        effects: [
          { kind: 'put-machine', row: updated },
          { kind: 'send', to: 'others', frame: { type: 'directory', machines: toDirectoryMachines(next.machines, withOnline(ctx.online, self)) } },
          { kind: 'log', type: f.type, environmentId: self, outcome: 'ok' },
        ],
      };
    }
    case 'forget': {
      const target = f.environmentId;
      if (!state.machines.some((m) => m.environmentId === target)) {
        return { state, effects: [{ kind: 'log', type: f.type, environmentId: target, outcome: 'unknown_machine' }] };
      }
      const next: DirectoryState = { ...state, machines: state.machines.filter((m) => m.environmentId !== target) };
      const online = withOnline(ctx.online, self === target ? null : self, target);
      return {
        state: next,
        effects: [
          { kind: 'delete-machine', environmentId: target },
          { kind: 'send', to: 'others', frame: { type: 'directory', machines: toDirectoryMachines(next.machines, online) } },
          ...(self === target
            ? []
            : [{ kind: 'send', to: 'self', frame: { type: 'directory', machines: toDirectoryMachines(next.machines, online) } } as const]),
          { kind: 'close', to: { environmentId: target }, code: CONNECT_CLOSE_CODES.forgotten, reason: 'forgotten' },
          ...(self === target ? [{ kind: 'close', to: 'self', code: CONNECT_CLOSE_CODES.forgotten, reason: 'forgotten' } as const] : []),
          { kind: 'log', type: f.type, environmentId: target, outcome: 'ok' },
        ],
      };
    }
    default:
      return {
        state,
        effects: [
          { kind: 'send', to: 'self', frame: errorFrame('unsupported', 'frame type not supported') },
          { kind: 'log', type: f.type, environmentId: self, outcome: 'unsupported' },
        ],
      };
  }
}

export function reduce(state: DirectoryState, event: DirectoryEvent, ctx: ReduceContext): ReduceResult {
  switch (event.kind) {
    case 'hello':
      return hello(state, event, ctx);
    case 'frame':
      return frame(state, event, ctx);
    case 'bad-frame': {
      const effects: DirectoryEffect[] = [];
      if (event.reason === 'unsupported') {
        effects.push({ kind: 'send', to: 'self', frame: errorFrame('unsupported', 'unsupported directory protocol') });
      } else {
        effects.push({ kind: 'send', to: 'self', frame: errorFrame('bad_frame', 'malformed frame') });
      }
      if (event.registeredAs === null || event.reason === 'unsupported') {
        effects.push({ kind: 'close', to: 'self', code: CONNECT_CLOSE_CODES.unsupportedProtocol, reason: event.reason });
      }
      effects.push({ kind: 'log', type: 'unknown', environmentId: event.registeredAs, outcome: event.reason });
      return { state, effects };
    }
    case 'socket-gone': {
      const row = state.machines.find((m) => m.environmentId === event.registeredAs);
      if (!row) return { state, effects: [] };
      const updated: MachineRow = { ...row, lastSeenAt: ctx.now };
      const next: DirectoryState = { ...state, machines: replaceRow(state.machines, updated) };
      return {
        state: next,
        effects: [
          { kind: 'put-machine', row: updated },
          { kind: 'send', to: 'others', frame: { type: 'directory', machines: toDirectoryMachines(next.machines, ctx.online) } },
          { kind: 'log', type: 'close', environmentId: event.registeredAs, outcome: 'offline' },
        ],
      };
    }
  }
}
