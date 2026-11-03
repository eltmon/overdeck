/**
 * The account directory's rules as a pure reducer (PRD PAN-2356 WI-5, D-2356-4), following the
 * share service's room-state.ts: `reduce(state, event, ctx) → { state, effects }`.
 *
 * The Durable Object glue (directory.ts) owns sockets and SQL storage. It hands the reducer the
 * current registry, the event and which machines are online, then runs the effects: persistence
 * first, then socket registration, then sends, then closes. The reducer never mutates its input.
 */
import {
  APPROVAL_TTL_MS,
  CONNECT_CLOSE_CODES,
  CONNECT_PROTOCOL_VERSION,
  FREE_MACHINE_LIMIT_MESSAGE,
} from '../../../packages/contracts/src/connect.ts';
import type {
  ClientPlatform,
  ConnectErrorCode,
  ConnectPlan,
  DirectoryEndpoint,
  DirectoryMachine,
  DirectoryToClientFrame,
  DirectoryToMachineFrame,
  MachineToDirectoryFrame,
  PushUrgency,
} from '../../../packages/contracts/src/connect.ts';
import { iceServersAnswer, relayUsageAnswer } from './ice-relay.ts';
import { pushAnswer } from './push-state.ts';
import type { PushWindow } from './push-state.ts';
import type { PushRegistration } from './push/config.ts';
import { relayStatusOf } from './relay-meter.ts';
import type { RelayUsage } from './relay-meter.ts';

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

/** One registered phone: a row of the `clients` table (PAN-4829). Never a machine. */
export interface ClientRow {
  readonly clientId: string;
  readonly label: string;
  readonly publicKeyHex: string;
  readonly platform: ClientPlatform;
  readonly appVersion: string;
  readonly deviceId: string;
  /** Unix milliseconds. */
  readonly registeredAt: number;
  /** Unix milliseconds. */
  readonly lastSeenAt: number;
  /** The phone's APNs or FCM token (PAN-4830); written only by `push-register` and `push-unregister`. */
  readonly push: PushRegistration | null;
}

/** A pending approval request (D-2356-9): a row of the `approvals` table. */
export interface ApprovalRow {
  readonly requestId: string;
  readonly fromEnv: string;
  /** null ⇒ every other machine of the account may approve. */
  readonly toEnv: string | null;
  /** Unix milliseconds. */
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface DirectoryState {
  /** The account plan last seen on a `hello`; null before the first one. */
  readonly plan: ConnectPlan | null;
  /** In registration order. */
  readonly machines: readonly MachineRow[];
  /** Registered phones in registration order (PAN-4829); they never count as machines. */
  readonly clients: readonly ClientRow[];
  /** Pending approvals, oldest first. Expired rows are dropped lazily on every event. */
  readonly approvals: readonly ApprovalRow[];
  /** The latest `relay_usage` row; a row from an earlier month counts as zero. */
  readonly relay: RelayUsage | null;
  /** This UTC minute's accepted pushes (PAN-4830 D-8), persisted as the `meta` row `push_window`. */
  readonly pushWindow: PushWindow | null;
}

export const MAX_PENDING_APPROVALS_PER_MACHINE = 1;
export const MAX_PENDING_APPROVALS_PER_ACCOUNT = 5;

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
  | { readonly kind: 'socket-gone'; readonly registeredAs: string }
  /** The account page removes a machine (PAN-4959 D-5). No socket made the request, so nothing goes to `self`. */
  | { readonly kind: 'remove-machine'; readonly environmentId: string };

export interface ReduceContext {
  /** Unix milliseconds. */
  readonly now: number;
  /** Environment ids with an open registered socket, not counting the event's own socket. */
  readonly online: ReadonlySet<string>;
  /** STUN servers handed out for `ice-servers { relay: false }` (the `STUN_URLS` var). */
  readonly stunUrls: readonly string[];
  /** Monthly relay allowance in bytes (`RELAY_MONTHLY_CAP_BYTES` unless `RELAY_CAP_BYTES` overrides it). */
  readonly relayCapBytes: number;
  /** Both TURN secrets are set. */
  readonly turnConfigured: boolean;
  /** Client ids with an open registered socket, not counting the event's own socket; absent ⇒ none (PAN-4829). */
  readonly onlineClients?: ReadonlySet<string>;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export const onlineClientsOf = (ctx: ReduceContext): ReadonlySet<string> => ctx.onlineClients ?? EMPTY_SET;

/**
 * Socket targets. `self` is the event's socket; `others` is every other registered **machine**
 * socket; `all` is self plus the other machines; `{ environmentId }` is that machine's registered
 * sockets except the event's own. `clients` is every registered client socket except self, and
 * `{ clientId }` is that client's sockets except self (PAN-4829).
 */
export type Target =
  | 'self'
  | 'others'
  | 'all'
  | 'clients'
  | { readonly environmentId: string }
  | { readonly clientId: string };

export type DirectoryEffect =
  | { readonly kind: 'put-plan'; readonly plan: ConnectPlan }
  | { readonly kind: 'put-machine'; readonly row: MachineRow }
  | { readonly kind: 'delete-machine'; readonly environmentId: string }
  | { readonly kind: 'put-approval'; readonly row: ApprovalRow }
  | { readonly kind: 'delete-approval'; readonly requestId: string }
  | { readonly kind: 'put-relay-usage'; readonly usage: RelayUsage }
  /** Mint TURN credentials and answer the event's socket with `ice-servers` or `turn_unavailable`. */
  | { readonly kind: 'fetch-turn'; readonly requestId: string }
  /** Inbox operations (inbox.ts) for the event's machine; the glue re-arms the alarm after them. */
  | { readonly kind: 'inbox-create'; readonly requestId: string }
  | { readonly kind: 'inbox-delete'; readonly inboxId: string }
  | { readonly kind: 'inbox-ack'; readonly eventId: string }
  | { readonly kind: 'inbox-nack'; readonly eventId: string; readonly retryAfterSeconds: number }
  /** Send every held event for the event's machine to its socket (after `welcome`). */
  | { readonly kind: 'inbox-deliver' }
  | { readonly kind: 'inbox-forget'; readonly environmentId: string }
  | { readonly kind: 'register'; readonly environmentId: string }
  /** Phone registry (PAN-4829): upsert or delete a `clients` row, and bind the event's socket to a client. */
  | { readonly kind: 'put-client'; readonly row: ClientRow }
  | { readonly kind: 'delete-client'; readonly clientId: string }
  | { readonly kind: 'register-client'; readonly clientId: string }
  /** Store or clear a phone's push registration (PAN-4830 D-5); `put-client` never touches it. */
  | { readonly kind: 'put-client-push'; readonly clientId: string; readonly registration: PushRegistration | null }
  | { readonly kind: 'put-push-window'; readonly window: PushWindow }
  /** Send one push to APNs or FCM, then feed the outcome back through `reducePushOutcome` (D-1). */
  | {
    readonly kind: 'deliver-push';
    readonly requestId: string;
    readonly clientId: string;
    readonly registration: PushRegistration;
    readonly sealed: string;
    readonly urgency: PushUrgency;
    readonly collapseId: string;
  }
  | { readonly kind: 'send'; readonly to: Target; readonly frame: DirectoryToMachineFrame | DirectoryToClientFrame }
  | { readonly kind: 'close'; readonly to: Target; readonly code: number; readonly reason: string }
  | {
    readonly kind: 'log';
    readonly type: string;
    readonly environmentId: string | null;
    readonly outcome: string;
    /** Set for a phone's events; logged beside the frame type, never its label or key. */
    readonly clientId?: string;
  };

export interface ReduceResult {
  readonly state: DirectoryState;
  readonly effects: DirectoryEffect[];
}

export const EMPTY_DIRECTORY: DirectoryState = { plan: null, machines: [], clients: [], approvals: [], relay: null, pushWindow: null };

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

export function errorFrame(code: ConnectErrorCode, message: string, extra?: { requestId?: string; session?: string }): DirectoryToMachineFrame {
  return { type: 'error', code, message, ...extra };
}

/**
 * A `directory` frame for the other machines and every phone (PAN-4829 FR-5). Approvals and inbox
 * frames never use this: `others` stays machine-only, so phones never receive them.
 */
function broadcastDirectory(machines: DirectoryMachine[]): DirectoryEffect[] {
  const frame = { type: 'directory', machines } as const;
  return [
    { kind: 'send', to: 'others', frame },
    { kind: 'send', to: 'clients', frame },
  ];
}

/** True when a live approval lets `a` and `b` exchange approval signals, in either direction. */
function approvalBetween(approvals: readonly ApprovalRow[], a: string, b: string): boolean {
  const pairs = (from: string, to: string) => (r: ApprovalRow) => r.fromEnv === from && (r.toEnv === null || r.toEnv === to);
  return approvals.some(pairs(a, b)) || approvals.some(pairs(b, a));
}

/** The `approval-request` frame for a row, or null when its requester left the directory. */
function approvalFrame(row: ApprovalRow, machines: readonly MachineRow[]): DirectoryToMachineFrame | null {
  const from = machines.find((m) => m.environmentId === row.fromEnv);
  if (!from) return null;
  return {
    type: 'approval-request',
    requestId: row.requestId,
    from: row.fromEnv,
    label: from.label,
    fingerprint: from.fingerprint,
    publicKeyHex: from.publicKeyHex,
    expiresAt: row.expiresAt,
  };
}

/** Drops expired approvals; the deletions are persisted with the event's other effects. */
function pruneApprovals(state: DirectoryState, now: number): ReduceResult {
  const live = state.approvals.filter((r) => r.expiresAt > now);
  if (live.length === state.approvals.length) return { state, effects: [] };
  const effects: DirectoryEffect[] = state.approvals
    .filter((r) => r.expiresAt <= now)
    .map((r) => ({ kind: 'delete-approval', requestId: r.requestId }));
  return { state: { ...state, approvals: live }, effects };
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
        relay: relayStatusOf(next.relay, ctx.now, ctx.relayCapBytes),
        machines,
      },
    },
    ...broadcastDirectory(machines),
  );
  for (const approval of next.approvals) {
    if (approval.fromEnv === env || (approval.toEnv !== null && approval.toEnv !== env)) continue;
    const pending = approvalFrame(approval, next.machines);
    if (pending) effects.push({ kind: 'send', to: 'self', frame: pending });
  }
  effects.push({ kind: 'inbox-deliver' });
  effects.push({ kind: 'log', type: 'hello', environmentId: env, outcome: existing ? 'updated' : 'registered' });
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
          ...broadcastDirectory(toDirectoryMachines(next.machines, withOnline(ctx.online, self))),
          { kind: 'log', type: f.type, environmentId: self, outcome: 'ok' },
        ],
      };
    }
    case 'forget': {
      const target = f.environmentId;
      if (!state.machines.some((m) => m.environmentId === target)) {
        return { state, effects: [{ kind: 'log', type: f.type, environmentId: target, outcome: 'unknown_machine' }] };
      }
      const dropped = state.approvals.filter((r) => r.fromEnv === target || r.toEnv === target);
      const next: DirectoryState = {
        ...state,
        machines: state.machines.filter((m) => m.environmentId !== target),
        approvals: state.approvals.filter((r) => !dropped.includes(r)),
      };
      const online = withOnline(ctx.online, self === target ? null : self, target);
      return {
        state: next,
        effects: [
          { kind: 'delete-machine', environmentId: target },
          ...dropped.map((r) => ({ kind: 'delete-approval', requestId: r.requestId }) as const),
          { kind: 'inbox-forget', environmentId: target },
          ...broadcastDirectory(toDirectoryMachines(next.machines, online)),
          ...(self === target
            ? []
            : [{ kind: 'send', to: 'self', frame: { type: 'directory', machines: toDirectoryMachines(next.machines, online) } } as const]),
          { kind: 'close', to: { environmentId: target }, code: CONNECT_CLOSE_CODES.forgotten, reason: 'forgotten' },
          ...(self === target ? [{ kind: 'close', to: 'self', code: CONNECT_CLOSE_CODES.forgotten, reason: 'forgotten' } as const] : []),
          { kind: 'log', type: f.type, environmentId: target, outcome: 'ok' },
        ],
      };
    }
    case 'signal': {
      const session = { session: f.session };
      const refuse = (code: ConnectErrorCode, message: string, outcome: string): ReduceResult => ({
        state,
        effects: [
          { kind: 'send', to: 'self', frame: errorFrame(code, message, session) },
          { kind: 'log', type: f.type, environmentId: self, outcome },
        ],
      });
      if (f.to === self) return refuse('bad_frame', 'a machine cannot signal itself', 'self');
      if (f.purpose === 'approval' && !approvalBetween(state.approvals, self, f.to)) {
        return refuse('approval_unknown', 'no pending approval between these machines', 'approval_unknown');
      }
      if (ctx.online.has(f.to)) {
        return {
          state,
          effects: [
            {
              kind: 'send',
              to: { environmentId: f.to },
              // `from` is the sender socket's machine, never a field of the frame (D-2356-6).
              frame: { type: 'signal', from: self, session: f.session, purpose: f.purpose, relay: f.relay, data: f.data },
            },
            { kind: 'log', type: f.type, environmentId: self, outcome: 'forwarded' },
          ],
        };
      }
      // A machine answers a phone's link offer (PAN-4829 D-7); approvals never reach a phone.
      if (onlineClientsOf(ctx).has(f.to) && f.purpose === 'link') {
        return {
          state,
          effects: [
            { kind: 'send', to: { clientId: f.to }, frame: { type: 'signal', from: self, session: f.session, purpose: 'link', relay: f.relay, data: f.data } },
            { kind: 'log', type: f.type, environmentId: self, outcome: 'forwarded_client' },
          ],
        };
      }
      return refuse('peer_offline', 'the other machine is offline', 'peer_offline');
    }
    case 'ice-servers':
      return iceServersAnswer(state, f, ctx, { environmentId: self });
    case 'inbox-create':
      if (state.plan !== 'tester') {
        return {
          state,
          effects: [
            { kind: 'send', to: 'self', frame: errorFrame('plan_required', 'the inbox needs the Anywhere plan', { requestId: f.requestId }) },
            { kind: 'log', type: f.type, environmentId: self, outcome: 'plan_required' },
          ],
        };
      }
      return { state, effects: [{ kind: 'inbox-create', requestId: f.requestId }, { kind: 'log', type: f.type, environmentId: self, outcome: 'ok' }] };
    case 'inbox-delete':
      return { state, effects: [{ kind: 'inbox-delete', inboxId: f.inboxId }, { kind: 'log', type: f.type, environmentId: self, outcome: 'ok' }] };
    case 'inbox-ack':
      return { state, effects: [{ kind: 'inbox-ack', eventId: f.eventId }, { kind: 'log', type: f.type, environmentId: self, outcome: 'ok' }] };
    case 'inbox-nack':
      return {
        state,
        effects: [
          { kind: 'inbox-nack', eventId: f.eventId, retryAfterSeconds: f.retryAfterSeconds },
          { kind: 'log', type: f.type, environmentId: self, outcome: 'ok' },
        ],
      };
    case 'relay-usage':
      return relayUsageAnswer(state, f.bytes, ctx, { environmentId: self });
    case 'approval-request': {
      const ids = { requestId: f.requestId };
      const refuse = (code: ConnectErrorCode, message: string, outcome: string): ReduceResult => ({
        state,
        effects: [
          { kind: 'send', to: 'self', frame: errorFrame(code, message, ids) },
          { kind: 'log', type: f.type, environmentId: self, outcome },
        ],
      });
      if (f.to === self || state.approvals.some((r) => r.requestId === f.requestId)) {
        return refuse('bad_frame', 'invalid approval request', 'bad_request');
      }
      if (state.approvals.filter((r) => r.fromEnv === self).length >= MAX_PENDING_APPROVALS_PER_MACHINE) {
        return refuse('approval_limit', 'this machine already has a pending approval request', 'approval_limit');
      }
      if (state.approvals.length >= MAX_PENDING_APPROVALS_PER_ACCOUNT) {
        return refuse('approval_limit', 'the account has too many pending approval requests', 'approval_limit');
      }
      const row: ApprovalRow = { requestId: f.requestId, fromEnv: self, toEnv: f.to, createdAt: ctx.now, expiresAt: ctx.now + APPROVAL_TTL_MS };
      const next: DirectoryState = { ...state, approvals: [...state.approvals, row] };
      const pending = approvalFrame(row, next.machines);
      return {
        state: next,
        effects: [
          { kind: 'put-approval', row },
          ...(pending ? [{ kind: 'send', to: f.to === null ? 'others' : { environmentId: f.to }, frame: pending } as const] : []),
          { kind: 'log', type: f.type, environmentId: self, outcome: 'stored' },
        ],
      };
    }
    case 'approval-cancel': {
      const row = state.approvals.find((r) => r.requestId === f.requestId);
      if (!row || (row.fromEnv !== self && row.toEnv !== null && row.toEnv !== self)) {
        return {
          state,
          effects: [
            { kind: 'send', to: 'self', frame: errorFrame('approval_unknown', 'no such pending approval', { requestId: f.requestId }) },
            { kind: 'log', type: f.type, environmentId: self, outcome: 'approval_unknown' },
          ],
        };
      }
      return {
        state: { ...state, approvals: state.approvals.filter((r) => r !== row) },
        effects: [
          { kind: 'delete-approval', requestId: row.requestId },
          { kind: 'send', to: 'others', frame: { type: 'approval-cancel', requestId: row.requestId } },
          { kind: 'log', type: f.type, environmentId: self, outcome: 'cancelled' },
        ],
      };
    }
    case 'push':
      return pushAnswer(state, f, ctx, self);
  }
}

export function reduce(state: DirectoryState, event: DirectoryEvent, ctx: ReduceContext): ReduceResult {
  const pruned = pruneApprovals(state, ctx.now);
  const result = reduceLive(pruned.state, event, ctx);
  return pruned.effects.length === 0 ? result : { state: result.state, effects: [...pruned.effects, ...result.effects] };
}

/** `forget` without a calling socket: every other machine and phone hears the new directory, the target closes 4012. */
function removeMachine(state: DirectoryState, event: Extract<DirectoryEvent, { kind: 'remove-machine' }>, ctx: ReduceContext): ReduceResult {
  const target = event.environmentId;
  if (!state.machines.some((m) => m.environmentId === target)) {
    return { state, effects: [{ kind: 'log', type: 'remove-machine', environmentId: target, outcome: 'unknown_machine' }] };
  }
  const dropped = state.approvals.filter((r) => r.fromEnv === target || r.toEnv === target);
  const next: DirectoryState = {
    ...state,
    machines: state.machines.filter((m) => m.environmentId !== target),
    approvals: state.approvals.filter((r) => !dropped.includes(r)),
  };
  return {
    state: next,
    effects: [
      { kind: 'delete-machine', environmentId: target },
      ...dropped.map((r) => ({ kind: 'delete-approval', requestId: r.requestId }) as const),
      { kind: 'inbox-forget', environmentId: target },
      ...broadcastDirectory(toDirectoryMachines(next.machines, withOnline(ctx.online, null, target))),
      { kind: 'close', to: { environmentId: target }, code: CONNECT_CLOSE_CODES.forgotten, reason: 'forgotten' },
      { kind: 'log', type: 'remove-machine', environmentId: target, outcome: 'ok' },
    ],
  };
}

function reduceLive(state: DirectoryState, event: DirectoryEvent, ctx: ReduceContext): ReduceResult {
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
          ...broadcastDirectory(toDirectoryMachines(next.machines, ctx.online)),
          { kind: 'log', type: 'close', environmentId: event.registeredAs, outcome: 'offline' },
        ],
      };
    }
    case 'remove-machine':
      return removeMachine(state, event, ctx);
  }
}
