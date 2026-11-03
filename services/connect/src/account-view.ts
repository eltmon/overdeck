/**
 * The account page's view of one Directory DO (PRD PAN-4959 WI-1).
 *
 * The account Worker reaches these internal DO paths through a cross-script Durable Object binding,
 * never through the public routes, so the DO trusts every request on them. The account Worker
 * declares the response shape structurally and never imports this module (PAN-4959 D-11).
 */
import type { RelayStatus } from '../../../packages/contracts/src/connect.ts';
import type { DirectoryState } from './directory-state.ts';
import { relayStatusOf } from './relay-meter.ts';

export const ACCOUNT_PATHS = { view: '/account-view', removeMachine: '/remove-machine', deleteAccount: '/delete-account' } as const;

/** Every table of the Directory DO; `/delete-account` empties each one and keeps the schema (D-6). */
export const ACCOUNT_TABLES = ['machines', 'meta', 'approvals', 'relay_usage', 'clients', 'inboxes', 'inbox_events'] as const;

export interface AccountViewMachine {
  environmentId: string;
  label: string;
  online: boolean;
  /** ISO-8601. */
  lastSeenAt: string;
  serverVersion: string;
  /** The device token that last said `hello`; the account page revokes it on Remove (D-3). */
  deviceId: string;
}

export interface AccountView {
  /** In registration order, oldest first. */
  machines: AccountViewMachine[];
  relay: RelayStatus;
}

/** `online` holds the environment ids with an open, registered socket. */
export function accountView(state: DirectoryState, online: ReadonlySet<string>, now: number, capBytes: number): AccountView {
  return {
    machines: state.machines.map((m) => ({
      environmentId: m.environmentId,
      label: m.label,
      online: online.has(m.environmentId),
      lastSeenAt: new Date(m.lastSeenAt).toISOString(),
      serverVersion: m.serverVersion,
      deviceId: m.deviceId,
    })),
    relay: relayStatusOf(state.relay, now, capBytes),
  };
}
