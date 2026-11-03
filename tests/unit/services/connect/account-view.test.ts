import { describe, expect, it } from 'vitest';
import { ACCOUNT_PATHS, ACCOUNT_TABLES, accountView } from '../../../../services/connect/src/account-view.ts';
import { EMPTY_DIRECTORY } from '../../../../services/connect/src/directory-state.ts';
import type { DirectoryState, MachineRow } from '../../../../services/connect/src/directory-state.ts';
import { SCHEMA } from '../../../../services/connect/src/directory-store.ts';
import { INBOX_SCHEMA } from '../../../../services/connect/src/inbox.ts';

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const CAP = 1_000;
const env = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

function machine(n: number, lastSeenAt: number): MachineRow {
  return {
    environmentId: env(n),
    label: `machine-${n}`,
    publicKeyHex: n.toString(16).padStart(2, '0').repeat(32),
    fingerprint: `fp-${n}`,
    endpoints: [],
    serverVersion: `0.7${n}.0`,
    deviceId: `d-${n}`,
    registeredAt: Date.UTC(2026, 9, n),
    lastSeenAt,
  };
}

const TWO: DirectoryState = { ...EMPTY_DIRECTORY, machines: [machine(1, Date.UTC(2026, 10, 1)), machine(2, Date.UTC(2026, 10, 2, 8, 30))] };

describe('account view (PAN-4959 WI-1)', () => {
  it('names the three internal DO paths', () => {
    expect(ACCOUNT_PATHS).toEqual({ view: '/account-view', removeMachine: '/remove-machine', deleteAccount: '/delete-account' });
  });

  it('lists both machines oldest first, online only for the one with an open socket', () => {
    const view = accountView(TWO, new Set([env(2)]), NOW, CAP);
    expect(view.machines).toEqual([
      { environmentId: env(1), label: 'machine-1', online: false, lastSeenAt: '2026-11-01T00:00:00.000Z', serverVersion: '0.71.0', deviceId: 'd-1' },
      { environmentId: env(2), label: 'machine-2', online: true, lastSeenAt: '2026-11-02T08:30:00.000Z', serverVersion: '0.72.0', deviceId: 'd-2' },
    ]);
  });

  it('counts a relay row from the previous UTC month as zero', () => {
    const view = accountView({ ...TWO, relay: { month: '2026-10', bytes: 5_000 } }, new Set(), NOW, CAP);
    expect(view.relay).toEqual({ month: '2026-11', bytesUsed: 0, capBytes: CAP, stopped: false });
  });

  it('reports the relay stopped when this month is at the cap', () => {
    const view = accountView({ ...TWO, relay: { month: '2026-11', bytes: CAP } }, new Set(), NOW, CAP);
    expect(view.relay).toEqual({ month: '2026-11', bytesUsed: CAP, capBytes: CAP, stopped: true });
  });

  it('answers an empty directory with no machines and an unused relay', () => {
    expect(accountView(EMPTY_DIRECTORY, new Set(), NOW, CAP)).toEqual({
      machines: [],
      relay: { month: '2026-11', bytesUsed: 0, capBytes: CAP, stopped: false },
    });
  });

  it('lists every table the Directory DO creates, so /delete-account empties all of them (WI-3)', () => {
    const created = [...SCHEMA, ...INBOX_SCHEMA].flatMap((sql) => /CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql)?.[1] ?? []);
    expect([...ACCOUNT_TABLES].sort()).toEqual([...created].sort());
  });
});
