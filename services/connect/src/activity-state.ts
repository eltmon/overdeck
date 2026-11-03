/**
 * The directory's Live Activity decisions as pure functions (PRD PAN-4839 WI-4, D-2 to D-5, OD-1).
 *
 * Each machine reports its two counts for each phone it is paired with (`push-activity`). The
 * directory keeps the last report per (clientId, environmentId) and pushes the sum of the fresh ones
 * to the phone's activity push token, so a card fed by several machines shows one total (D-3).
 * Reports are kept even while the phone has no registration, so a new `activity-register` can push
 * at once (D-4).
 *
 * It imports only types from directory-state.ts, like push-state.ts, so the runtime import graph
 * stays acyclic. Effects and logs carry ids, the activity token (only in `put-client-activity` and
 * `deliver-activity`) and the two numbers, nothing else.
 */
import { ACTIVITY_COUNT_MAX, ACTIVITY_PUSH_RATE_PER_MINUTE, ACTIVITY_REFRESH_MS, ACTIVITY_STALE_MS } from '../../../packages/contracts/src/connect.ts';
import type { ApsEnvironment, ClientToDirectoryFrame, MachineToDirectoryFrame } from '../../../packages/contracts/src/connect.ts';
import type { ClientRow, DirectoryEffect, DirectoryState, ReduceContext, ReduceResult } from './directory-state.ts';
import type { PushWindow } from './push-state.ts';
import type { PushOutcome } from './push/config.ts';

type ActivityRegistrationFrame = Extract<ClientToDirectoryFrame, { type: 'activity-register' | 'activity-unregister' }>;
type PushActivityFrame = Extract<MachineToDirectoryFrame, { type: 'push-activity' }>;

/** The sum last sent to APNs for one phone, and when (Unix milliseconds). */
export interface ActivityPushed {
  readonly needsYou: number;
  readonly running: number;
  readonly at: number;
}

/** A phone's Live Activity push token; written only by `activity-register`, `activity-unregister` and outcomes. */
export interface ActivityRegistration {
  readonly token: string;
  readonly apsEnvironment: ApsEnvironment;
  readonly lastPushed: ActivityPushed | null;
}

/** One machine's last counts for one phone: a row of `activity_reports`. */
export interface ActivityReport {
  readonly clientId: string;
  readonly environmentId: string;
  readonly needsYou: number;
  readonly running: number;
  /** Unix milliseconds. */
  readonly reportedAt: number;
}

/** A finished Live Activity delivery, fed back by the glue after `deliver-activity`. */
export interface ActivityOutcomeEvent {
  readonly clientId: string;
  /** The token the delivery used; a dead-token answer clears only this one. */
  readonly token: string;
  readonly outcome: PushOutcome;
}

type Log = (outcome: string) => DirectoryEffect;

const clientLog = (type: string, clientId: string): Log => (outcome) => ({ kind: 'log', type, environmentId: null, outcome, clientId });

/** The state with one phone's activity registration replaced. */
function withActivity(state: DirectoryState, clientId: string, activity: ActivityRegistration | null): DirectoryState {
  return { ...state, clients: state.clients.map((c): ClientRow => (c.clientId === clientId ? { ...c, activity } : c)) };
}

/** The phone's fresh reports summed, each count clamped to ACTIVITY_COUNT_MAX; null when none is fresh. */
function freshSum(state: DirectoryState, clientId: string, now: number): { needsYou: number; running: number } | null {
  const fresh = state.activityReports.filter((r) => r.clientId === clientId && r.reportedAt >= now - ACTIVITY_STALE_MS);
  if (fresh.length === 0) return null;
  const needsYou = fresh.reduce((n, r) => n + r.needsYou, 0);
  const running = fresh.reduce((n, r) => n + r.running, 0);
  return { needsYou: Math.min(needsYou, ACTIVITY_COUNT_MAX), running: Math.min(running, ACTIVITY_COUNT_MAX) };
}

/**
 * Pushes the phone's fresh sum when it changed, or when the last push is `ACTIVITY_REFRESH_MS` old
 * so the stale date moves ahead (D-5), within `ACTIVITY_PUSH_RATE_PER_MINUTE` per account and UTC
 * minute. The window is apart from the alert push window (NFR-1).
 */
function pushIfDue(state: DirectoryState, clientId: string, ctx: ReduceContext, log: Log): ReduceResult {
  const sum = freshSum(state, clientId, ctx.now);
  if (sum === null) return { state, effects: [] };
  const registration = state.clients.find((c) => c.clientId === clientId)?.activity ?? null;
  if (registration === null) return { state, effects: [log('no_registration')] };
  const last = registration.lastPushed;
  const changed = last === null || last.needsYou !== sum.needsYou || last.running !== sum.running;
  if (!changed && ctx.now - last.at < ACTIVITY_REFRESH_MS) return { state, effects: [log('unchanged')] };
  const minute = Math.floor(ctx.now / 60_000);
  const count = state.activityWindow?.minute === minute ? state.activityWindow.count : 0;
  if (count >= ACTIVITY_PUSH_RATE_PER_MINUTE) return { state, effects: [log('rate_limited')] };
  const window: PushWindow = { minute, count: count + 1 };
  const next: ActivityRegistration = { ...registration, lastPushed: { ...sum, at: ctx.now } };
  return {
    state: { ...withActivity(state, clientId, next), activityWindow: window },
    effects: [
      { kind: 'put-client-activity', clientId, registration: next },
      { kind: 'put-activity-window', window },
      {
        kind: 'deliver-activity',
        clientId,
        token: registration.token,
        apsEnvironment: registration.apsEnvironment,
        needsYou: sum.needsYou,
        running: sum.running,
        priority: changed ? 'high' : 'normal',
      },
      log(changed ? 'pushed' : 'refreshed'),
    ],
  };
}

/**
 * `activity-register` stores the phone's activity token and pushes its current sum at once (D-4);
 * `activity-unregister` clears it. Live Activities are iOS only.
 */
export function activityRegistrationAnswer(state: DirectoryState, clientId: string, f: ActivityRegistrationFrame, ctx: ReduceContext): ReduceResult {
  const log = clientLog(f.type, clientId);
  const row = state.clients.find((c) => c.clientId === clientId);
  if (!row) return { state, effects: [log('unknown_client')] };
  if (f.type === 'activity-unregister') {
    return {
      state: withActivity(state, clientId, null),
      effects: [{ kind: 'put-client-activity', clientId, registration: null }, log('unregistered')],
    };
  }
  if (row.platform !== 'ios') {
    return {
      state,
      effects: [
        { kind: 'send', to: 'self', frame: { type: 'error', code: 'bad_frame', message: 'live activities are iOS only' } },
        log('platform_mismatch'),
      ],
    };
  }
  // iOS without `apsEnvironment` is a Release build (production), as for `push-register`.
  const registration: ActivityRegistration = { token: f.token, apsEnvironment: f.apsEnvironment ?? 'production', lastPushed: null };
  const registered = withActivity(state, clientId, registration);
  const pushed = pushIfDue(registered, clientId, ctx, log);
  const stored = pushed.effects.some((e) => e.kind === 'put-client-activity');
  return {
    state: pushed.state,
    effects: [...(stored ? [] : [{ kind: 'put-client-activity', clientId, registration } as const]), log('registered'), ...pushed.effects],
  };
}

/** A machine's `push-activity`: store its report for that phone, then push the sum if due (D-3). */
export function pushActivityAnswer(state: DirectoryState, f: PushActivityFrame, ctx: ReduceContext, selfEnv: string): ReduceResult {
  const log: Log = (outcome) => ({ kind: 'log', type: f.type, environmentId: selfEnv, outcome, clientId: f.to });
  if (!state.clients.some((c) => c.clientId === f.to)) return { state, effects: [log('unknown_client')] };
  const report: ActivityReport = { clientId: f.to, environmentId: selfEnv, needsYou: f.needsYou, running: f.running, reportedAt: ctx.now };
  const reports = [...state.activityReports.filter((r) => r.clientId !== f.to || r.environmentId !== selfEnv), report];
  const pushed = pushIfDue({ ...state, activityReports: reports }, f.to, ctx, log);
  return { state: pushed.state, effects: [{ kind: 'put-activity-report', report }, ...pushed.effects] };
}

/**
 * The answer once delivery returns, reduced against the state current after the delivery's await,
 * so a phone that re-registered meanwhile keeps its new token.
 */
export function reduceActivityOutcome(state: DirectoryState, event: ActivityOutcomeEvent): ReduceResult {
  const { clientId, outcome } = event;
  const log = clientLog('push-activity', clientId);
  const registration = state.clients.find((c) => c.clientId === clientId)?.activity ?? null;
  const current = registration?.token === event.token ? registration : null;
  switch (outcome.kind) {
    case 'delivered':
      return { state, effects: [log('delivered')] };
    case 'gone':
      if (current === null) return { state, effects: [log('gone')] };
      return {
        state: withActivity(state, clientId, null),
        effects: [{ kind: 'put-client-activity', clientId, registration: null }, log('gone')],
      };
    case 'failed':
    case 'not_configured': {
      const outcomeLog = log(outcome.kind === 'failed' ? `failed_${outcome.detail}` : 'not_configured');
      if (current === null) return { state, effects: [outcomeLog] };
      // The next report pushes again.
      const next: ActivityRegistration = { ...current, lastPushed: null };
      return {
        state: withActivity(state, clientId, next),
        effects: [{ kind: 'put-client-activity', clientId, registration: next }, outcomeLog],
      };
    }
  }
}

/** The account's reports without one phone's (after `forget-client`). */
export function withoutClientReports(state: DirectoryState, clientId: string): readonly ActivityReport[] {
  return state.activityReports.filter((r) => r.clientId !== clientId);
}

/** The account's reports without one machine's (after `forget`). */
export function withoutMachineReports(state: DirectoryState, environmentId: string): readonly ActivityReport[] {
  return state.activityReports.filter((r) => r.environmentId !== environmentId);
}
