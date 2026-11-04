import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MACHINE_TAG, roleOf } from '../../../../services/connect/src/directory.ts';
import { RELAY_MONTHLY_CAP_BYTES } from '../../../../packages/contracts/src/connect.ts';
import type { MachineToDirectoryFrame } from '../../../../packages/contracts/src/connect.ts';
import { reduceClient } from '../../../../services/connect/src/client-state.ts';
import { EMPTY_DIRECTORY, reduce } from '../../../../services/connect/src/directory-state.ts';
import type { DirectoryEffect, DirectoryState, ReduceContext } from '../../../../services/connect/src/directory-state.ts';
import {
  DELETE_CLIENT_ACTIVITY_ROWS_SQL,
  loadDirectory,
  PUT_CLIENT_PUSH_SQL,
  PUT_CLIENT_SQL,
  PUT_PUSH_WINDOW_SQL,
  SCHEMA,
  writeActivityEffect,
} from '../../../../services/connect/src/directory-store.ts';
import type { ConnectIdentity } from '../../../../services/connect/src/env.ts';
import { logFrame } from '../../../../services/connect/src/log.ts';

const IDENTITY: ConnectIdentity = { userId: 'u-1', githubId: 1, deviceId: 'd-1', plan: 'free', maxDevices: 3 };
const ENV = '00000000-0000-4000-8000-000000000001';
const CLIENT = '00000000-0000-4000-9000-000000000001';
const PUSH_COLUMNS = ['push_platform', 'push_token', 'aps_environment'];

describe('directory glue for phone clients (PAN-4829 WI-6)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the machine tag and reads a pre-PAN-4829 attachment as a machine', () => {
    expect(MACHINE_TAG).toBe('machine');
    expect(roleOf({ identity: IDENTITY, environmentId: ENV })).toBe('machine');
    expect(roleOf({ identity: IDENTITY, environmentId: null })).toBeNull();
    expect(roleOf({ identity: IDENTITY, environmentId: null, clientId: null })).toBeNull();
    expect(roleOf({ identity: IDENTITY, environmentId: null, clientId: CLIENT })).toBe('client');
  });

  it('creates the clients table with nullable push columns that the upsert never writes', () => {
    const create = SCHEMA.find((statement) => statement.includes('CREATE TABLE IF NOT EXISTS clients'));
    expect(create).toBeDefined();
    for (const column of PUSH_COLUMNS) {
      expect(create).toMatch(new RegExp(`${column} TEXT\\s*[,)]`));
      expect(PUT_CLIENT_SQL).not.toContain(column);
    }
  });

  it('writes the push registration with its own statement that names exactly the three push columns (PAN-4830 D-5)', () => {
    expect(PUT_CLIENT_PUSH_SQL).toBe('UPDATE clients SET push_platform = ?, push_token = ?, aps_environment = ? WHERE client_id = ?');
    const assigned = /SET (.*) WHERE/.exec(PUT_CLIENT_PUSH_SQL)?.[1].split(',').map((part) => part.trim().split(' ')[0]);
    expect(assigned).toEqual(PUSH_COLUMNS);
    for (const column of PUSH_COLUMNS) expect(PUT_CLIENT_SQL).not.toContain(column);
  });

  it('logs the client id only when one is given', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line);
    });
    logFrame('hello-client', null, 'registered', CLIENT);
    logFrame('hello', ENV, 'registered');
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({ frame: 'hello-client', env: null, outcome: 'registered', client: CLIENT });
    expect(JSON.parse(lines[1] ?? '{}')).toEqual({ frame: 'hello', env: ENV, outcome: 'registered' });
  });
});

/** Durable Object `SqlStorage.exec` over node:sqlite, as inbox.test.ts does. */
function sqlShim(): SqlStorage {
  const db = new DatabaseSync(':memory:');
  return {
    exec(query: string, ...bindings: Array<string | number | null>) {
      const statement = db.prepare(query);
      const rows = /^\s*SELECT/i.test(query) ? statement.all(...bindings) : (statement.run(...bindings), []);
      return { toArray: () => rows };
    },
  } as unknown as SqlStorage;
}

describe('directory storage round trip (PAN-4830)', () => {
  const phone = (n: number) => `00000000-0000-4000-9000-00000000000${n}`;

  it('reloads push registrations and the push window after a restart', () => {
    const sql = sqlShim();
    for (const statement of SCHEMA) sql.exec(statement);
    for (const [n, platform] of [[1, 'ios'], [2, 'ios'], [3, 'android'], [4, 'ios'], [5, 'ios']] as const) {
      sql.exec(PUT_CLIENT_SQL, phone(n), `phone-${n}`, 'ab'.repeat(32), platform, '1.0.0', 'd-1', n, n);
    }
    sql.exec(PUT_CLIENT_PUSH_SQL, 'ios', 'ios-sandbox-token', 'sandbox', phone(1));
    sql.exec(PUT_CLIENT_PUSH_SQL, 'ios', 'ios-release-token', null, phone(2));
    sql.exec(PUT_CLIENT_PUSH_SQL, 'android', 'fcm-token', null, phone(3));
    sql.exec(PUT_CLIENT_PUSH_SQL, 'ios', 'cleared-token', 'production', phone(5));
    sql.exec(PUT_CLIENT_PUSH_SQL, null, null, null, phone(5));
    sql.exec(PUT_PUSH_WINDOW_SQL, JSON.stringify({ minute: 29_000_000, count: 7 }));
    // A re-hello upserts the identity columns and must keep the registration.
    sql.exec(PUT_CLIENT_SQL, phone(1), 'phone-1-renamed', 'ab'.repeat(32), 'ios', '1.1.0', 'd-1', 1, 9);

    const state = loadDirectory(sql);
    expect(state.clients.map((c) => [c.clientId, c.push])).toEqual([
      [phone(1), { platform: 'ios', token: 'ios-sandbox-token', apsEnvironment: 'sandbox' }],
      [phone(2), { platform: 'ios', token: 'ios-release-token', apsEnvironment: 'production' }],
      [phone(3), { platform: 'android', token: 'fcm-token', apsEnvironment: null }],
      [phone(4), null],
      [phone(5), null],
    ]);
    expect(state.clients[0]?.label).toBe('phone-1-renamed');
    expect(state.pushWindow).toEqual({ minute: 29_000_000, count: 7 });
  });

  it('reloads a connector row and still drops an unknown platform (PAN-4927 D-18)', () => {
    const sql = sqlShim();
    for (const statement of SCHEMA) sql.exec(statement);
    const connector = '00000000-0000-4000-9000-000000000101';
    const web = '00000000-0000-4000-9000-000000000102';
    sql.exec(PUT_CLIENT_SQL, phone(1), 'phone-1', 'ab'.repeat(32), 'ios', '1.0.0', 'd-1', 1, 1);
    sql.exec(PUT_CLIENT_SQL, connector, 'connector-1', 'cd'.repeat(32), 'node', '1.0.0', 'd-1', 2, 2);
    sql.exec(PUT_CLIENT_SQL, web, 'web-1', 'ef'.repeat(32), 'web', '1.0.0', 'd-1', 3, 3);

    const state = loadDirectory(sql);
    expect(state.clients.map((c) => c.clientId)).toEqual([phone(1), connector]);
    expect(state.clients.find((c) => c.clientId === connector)).toMatchObject({ platform: 'node', push: null });
  });

  it('reads a missing or malformed push window as null', () => {
    const sql = sqlShim();
    for (const statement of SCHEMA) sql.exec(statement);
    expect(loadDirectory(sql).pushWindow).toBeNull();
    sql.exec(PUT_PUSH_WINDOW_SQL, 'not json');
    expect(loadDirectory(sql).pushWindow).toBeNull();
    sql.exec(PUT_PUSH_WINDOW_SQL, JSON.stringify({ minute: 1, count: -1 }));
    expect(loadDirectory(sql).pushWindow).toBeNull();
  });
});

describe('Live Activity storage round trip (PAN-4839 WI-4)', () => {
  const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
  const ENV_B = '00000000-0000-4000-8000-000000000002';
  const context: ReduceContext = { now: NOW, online: new Set(), stunUrls: [], relayCapBytes: RELAY_MONTHLY_CAP_BYTES, turnConfigured: false };
  const identity = { deviceId: 'd-1', plan: 'free', maxDevices: 3 } as const;

  /** The storage half of directory.ts's executor for the effects these frames produce. */
  function persist(sql: SqlStorage, effects: DirectoryEffect[]): void {
    for (const e of effects) {
      switch (e.kind) {
        case 'put-client': {
          const r = e.row;
          sql.exec(PUT_CLIENT_SQL, r.clientId, r.label, r.publicKeyHex, r.platform, r.appVersion, r.deviceId, r.registeredAt, r.lastSeenAt);
          break;
        }
        case 'delete-client':
          sql.exec('DELETE FROM clients WHERE client_id = ?', e.clientId);
          for (const statement of DELETE_CLIENT_ACTIVITY_ROWS_SQL) sql.exec(statement, e.clientId);
          break;
        case 'put-client-activity':
        case 'put-activity-report':
        case 'put-activity-window':
          writeActivityEffect(sql, e);
          break;
        default:
          break;
      }
    }
  }

  function run(sql: SqlStorage, result: { state: DirectoryState; effects: DirectoryEffect[] }): DirectoryState {
    persist(sql, result.effects);
    return result.state;
  }

  const count = (sql: SqlStorage, table: string) => (sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).toArray()[0]?.n ?? -1);

  it('rebuilds the registration, reports and window, and forget-client deletes both tables’ rows', () => {
    const sql = sqlShim();
    for (const statement of SCHEMA) sql.exec(statement);
    const hello = { type: 'hello-client', protocol: 1, clientId: CLIENT, label: 'phone', publicKeyHex: 'ab'.repeat(32), appVersion: '1.0.0', platform: 'ios' } as const;
    let state = run(sql, reduceClient(EMPTY_DIRECTORY, { kind: 'hello-client', registeredAs: null, identity, frame: hello }, context));
    const register = { type: 'activity-register', token: 'a1'.repeat(32), apsEnvironment: 'sandbox' } as const;
    state = run(sql, reduceClient(state, { kind: 'client-frame', clientId: CLIENT, frame: register }, context));
    for (const [env, needsYou, running] of [[ENV, 2, 1], [ENV_B, 1, 0]] as const) {
      const frame: MachineToDirectoryFrame = { type: 'push-activity', to: CLIENT, needsYou, running };
      state = run(sql, reduce(state, { kind: 'frame', registeredAs: env, frame }, context));
    }

    const loaded = loadDirectory(sql);
    expect(loaded.clients.map((c) => c.activity)).toEqual(state.clients.map((c) => c.activity));
    expect(loaded.clients[0]?.activity).toEqual({ token: 'a1'.repeat(32), apsEnvironment: 'sandbox', lastPushed: { needsYou: 3, running: 1, at: NOW } });
    expect(loaded.activityReports).toEqual(state.activityReports);
    expect(loaded.activityReports).toHaveLength(2);
    expect(loaded.activityWindow).toEqual(state.activityWindow);
    expect(loaded.activityWindow).toEqual({ minute: Math.floor(NOW / 60_000), count: 2 });

    run(sql, reduceClient(state, { kind: 'client-frame', clientId: CLIENT, frame: { type: 'forget-client' } }, context));
    expect(count(sql, 'client_activities')).toBe(0);
    expect(count(sql, 'activity_reports')).toBe(0);
  });

  it('deletes the activity row on unregister and reads a missing activity window as null', () => {
    const sql = sqlShim();
    for (const statement of SCHEMA) sql.exec(statement);
    sql.exec(PUT_CLIENT_SQL, CLIENT, 'phone', 'ab'.repeat(32), 'ios', '1.0.0', 'd-1', 1, 1);
    writeActivityEffect(sql, { kind: 'put-client-activity', clientId: CLIENT, registration: { token: 'tok', apsEnvironment: 'production', lastPushed: null } });
    expect(loadDirectory(sql).clients[0]?.activity).toEqual({ token: 'tok', apsEnvironment: 'production', lastPushed: null });
    expect(loadDirectory(sql).activityWindow).toBeNull();
    writeActivityEffect(sql, { kind: 'put-client-activity', clientId: CLIENT, registration: null });
    expect(loadDirectory(sql).clients[0]?.activity).toBeNull();
    expect(count(sql, 'client_activities')).toBe(0);
  });
});
