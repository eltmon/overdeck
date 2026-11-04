/**
 * SQLite storage for one account's directory (PRD PAN-4830 WI-1, D-15).
 *
 * The table definitions, the `clients` upsert and the read that rebuilds `DirectoryState` from the
 * tables at wake-up. directory.ts runs every write; the Live Activity writes (PAN-4839) go through
 * `writeActivityEffect` here.
 */
import type { ConnectPlan, DirectoryEndpoint } from '../../../packages/contracts/src/connect.ts';
import type { ActivityRegistration, ActivityReport } from './activity-state.ts';
import type { ApprovalRow, ClientRow, DirectoryEffect, DirectoryState, MachineRow } from './directory-state.ts';
import type { PushWindow } from './push-state.ts';
import type { PushRegistration } from './push/config.ts';
import type { RelayUsage } from './relay-meter.ts';

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS machines (
    environment_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    public_key_hex TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    endpoints_json TEXT NOT NULL,
    server_version TEXT NOT NULL,
    device_id TEXT NOT NULL,
    registered_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS approvals (
    request_id TEXT PRIMARY KEY,
    from_env TEXT NOT NULL,
    to_env TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS relay_usage (month TEXT PRIMARY KEY, bytes INTEGER NOT NULL)`,
  // Phones (PAN-4829). The push columns hold the phone's push registration (PAN-4830) and are
  // written only by PUT_CLIENT_PUSH_SQL.
  `CREATE TABLE IF NOT EXISTS clients (
    client_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    public_key_hex TEXT NOT NULL,
    platform TEXT NOT NULL,
    app_version TEXT NOT NULL,
    device_id TEXT NOT NULL,
    registered_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    push_platform TEXT,
    push_token TEXT,
    aps_environment TEXT
  )`,
  // Live Activity (PAN-4839): one activity token per phone, and each machine's last counts per phone.
  `CREATE TABLE IF NOT EXISTS client_activities (
    client_id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    aps_environment TEXT NOT NULL,
    last_needs_you INTEGER,
    last_running INTEGER,
    last_pushed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS activity_reports (
    client_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    needs_you INTEGER NOT NULL,
    running INTEGER NOT NULL,
    reported_at INTEGER NOT NULL,
    PRIMARY KEY (client_id, environment_id)
  )`,
];

/** The `clients` upsert. It never writes the push columns, so a re-registering phone keeps them (D-13). */
export const PUT_CLIENT_SQL = `INSERT INTO clients (client_id, label, public_key_hex, platform, app_version, device_id, registered_at, last_seen_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(client_id) DO UPDATE SET label = excluded.label, public_key_hex = excluded.public_key_hex,
    platform = excluded.platform, app_version = excluded.app_version, device_id = excluded.device_id,
    last_seen_at = excluded.last_seen_at`;

/** A phone's push registration (PAN-4830 D-5): `push-register` sets it, `push-unregister` and a dead token clear it. */
export const PUT_CLIENT_PUSH_SQL = 'UPDATE clients SET push_platform = ?, push_token = ?, aps_environment = ? WHERE client_id = ?';

/** The push rate-limit window (PAN-4830 D-8), a JSON `{ minute, count }` in `meta`. */
export const PUT_PUSH_WINDOW_SQL = `INSERT INTO meta (key, value) VALUES ('push_window', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

/** A phone's Live Activity registration and the sum last pushed to it. */
export const PUT_CLIENT_ACTIVITY_SQL = `INSERT INTO client_activities (client_id, token, aps_environment, last_needs_you, last_running, last_pushed_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(client_id) DO UPDATE SET token = excluded.token, aps_environment = excluded.aps_environment,
    last_needs_you = excluded.last_needs_you, last_running = excluded.last_running, last_pushed_at = excluded.last_pushed_at`;

export const DELETE_CLIENT_ACTIVITY_SQL = 'DELETE FROM client_activities WHERE client_id = ?';

/** One machine's last counts for one phone. */
export const PUT_ACTIVITY_REPORT_SQL = `INSERT INTO activity_reports (client_id, environment_id, needs_you, running, reported_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(client_id, environment_id) DO UPDATE SET needs_you = excluded.needs_you, running = excluded.running,
    reported_at = excluded.reported_at`;

/** The Live Activity rate-limit window, a JSON `{ minute, count }` in `meta`, apart from `push_window`. */
export const PUT_ACTIVITY_WINDOW_SQL = `INSERT INTO meta (key, value) VALUES ('activity_window', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

/** The rows a phone or a machine leaves behind when it is forgotten. */
export const DELETE_CLIENT_ACTIVITY_ROWS_SQL = [DELETE_CLIENT_ACTIVITY_SQL, 'DELETE FROM activity_reports WHERE client_id = ?'];
export const DELETE_MACHINE_ACTIVITY_REPORTS_SQL = 'DELETE FROM activity_reports WHERE environment_id = ?';

type ActivityWriteEffect = Extract<DirectoryEffect, { kind: 'put-client-activity' | 'put-activity-report' | 'put-activity-window' }>;

/** Runs one Live Activity storage effect. */
export function writeActivityEffect(sql: SqlStorage, e: ActivityWriteEffect): void {
  switch (e.kind) {
    case 'put-client-activity': {
      const r = e.registration;
      if (r === null) {
        sql.exec(DELETE_CLIENT_ACTIVITY_SQL, e.clientId);
        return;
      }
      const last = r.lastPushed;
      sql.exec(PUT_CLIENT_ACTIVITY_SQL, e.clientId, r.token, r.apsEnvironment, last?.needsYou ?? null, last?.running ?? null, last?.at ?? null);
      return;
    }
    case 'put-activity-report': {
      const r = e.report;
      sql.exec(PUT_ACTIVITY_REPORT_SQL, r.clientId, r.environmentId, r.needsYou, r.running, r.reportedAt);
      return;
    }
    case 'put-activity-window':
      sql.exec(PUT_ACTIVITY_WINDOW_SQL, JSON.stringify(e.window));
      return;
  }
}

interface ClientActivitySqlRow {
  client_id: string;
  token: string;
  aps_environment: string;
  last_needs_you: number | null;
  last_running: number | null;
  last_pushed_at: number | null;
  [key: string]: SqlStorageValue;
}

interface ActivityReportSqlRow {
  client_id: string;
  environment_id: string;
  needs_you: number;
  running: number;
  reported_at: number;
  [key: string]: SqlStorageValue;
}

/** A stored activity registration; `aps_environment` other than `sandbox` reads as production. */
function activityOf(r: ClientActivitySqlRow | undefined): ActivityRegistration | null {
  if (r === undefined || r.token === '') return null;
  const lastPushed = r.last_pushed_at === null || r.last_needs_you === null || r.last_running === null
    ? null
    : { needsYou: r.last_needs_you, running: r.last_running, at: r.last_pushed_at };
  return { token: r.token, apsEnvironment: r.aps_environment === 'sandbox' ? 'sandbox' : 'production', lastPushed };
}

interface ClientSqlRow {
  client_id: string;
  label: string;
  public_key_hex: string;
  platform: string;
  app_version: string;
  device_id: string;
  registered_at: number;
  last_seen_at: number;
  push_platform: string | null;
  push_token: string | null;
  aps_environment: string | null;
  [key: string]: SqlStorageValue;
}

interface ApprovalSqlRow {
  request_id: string;
  from_env: string;
  to_env: string | null;
  created_at: number;
  expires_at: number;
  [key: string]: SqlStorageValue;
}

interface MachineSqlRow {
  environment_id: string;
  label: string;
  public_key_hex: string;
  fingerprint: string;
  endpoints_json: string;
  server_version: string;
  device_id: string;
  registered_at: number;
  last_seen_at: number;
  [key: string]: SqlStorageValue;
}

/** The row's push registration, or null when the push columns are empty or unrecognised. */
function pushOf(r: ClientSqlRow): PushRegistration | null {
  if (typeof r.push_token !== 'string' || r.push_token === '') return null;
  if (r.push_platform === 'ios') {
    return { platform: 'ios', token: r.push_token, apsEnvironment: r.aps_environment === 'sandbox' ? 'sandbox' : 'production' };
  }
  if (r.push_platform === 'android') return { platform: 'android', token: r.push_token, apsEnvironment: null };
  return null;
}

/** A stored rate window (`push_window` or `activity_window`), or null when it is absent, not JSON or the wrong shape. */
function pushWindowOf(raw: string | undefined): PushWindow | null {
  if (raw === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { minute, count } = value as Record<string, unknown>;
  if (typeof minute !== 'number' || !Number.isSafeInteger(minute) || minute < 0) return null;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null;
  return { minute, count };
}

/** Rebuilds the reducer state from the tables, oldest first. */
export function loadDirectory(sql: SqlStorage): DirectoryState {
  const machines = sql
    .exec<MachineSqlRow>('SELECT * FROM machines ORDER BY registered_at, environment_id')
    .toArray()
    .map((r): MachineRow => ({
      environmentId: r.environment_id,
      label: r.label,
      publicKeyHex: r.public_key_hex,
      fingerprint: r.fingerprint,
      endpoints: JSON.parse(r.endpoints_json) as DirectoryEndpoint[],
      serverVersion: r.server_version,
      deviceId: r.device_id,
      registeredAt: r.registered_at,
      lastSeenAt: r.last_seen_at,
    }));
  const planRow = sql.exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'plan'`).toArray()[0];
  const plan = planRow?.value === 'free' || planRow?.value === 'tester' ? (planRow.value as ConnectPlan) : null;
  const approvals = sql
    .exec<ApprovalSqlRow>('SELECT * FROM approvals ORDER BY created_at, request_id')
    .toArray()
    .map((r): ApprovalRow => ({
      requestId: r.request_id,
      fromEnv: r.from_env,
      toEnv: r.to_env,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    }));
  const relayRow = sql.exec<{ month: string; bytes: number }>('SELECT month, bytes FROM relay_usage ORDER BY month DESC LIMIT 1').toArray()[0];
  const relay: RelayUsage | null = relayRow ? { month: relayRow.month, bytes: relayRow.bytes } : null;
  const activities = new Map(
    sql.exec<ClientActivitySqlRow>('SELECT * FROM client_activities').toArray().map((r) => [r.client_id, r] as const),
  );
  const clients = sql
    .exec<ClientSqlRow>('SELECT * FROM clients ORDER BY registered_at, client_id')
    .toArray()
    .flatMap((r): ClientRow[] =>
      r.platform === 'ios' || r.platform === 'android' || r.platform === 'node'
        ? [{
          clientId: r.client_id,
          label: r.label,
          publicKeyHex: r.public_key_hex,
          platform: r.platform,
          appVersion: r.app_version,
          deviceId: r.device_id,
          registeredAt: r.registered_at,
          lastSeenAt: r.last_seen_at,
          push: pushOf(r),
          activity: activityOf(activities.get(r.client_id)),
        }]
        : []);
  const windowRow = sql.exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'push_window'`).toArray()[0];
  const activityReports = sql
    .exec<ActivityReportSqlRow>('SELECT * FROM activity_reports ORDER BY reported_at, client_id, environment_id')
    .toArray()
    .map((r): ActivityReport => ({
      clientId: r.client_id,
      environmentId: r.environment_id,
      needsYou: r.needs_you,
      running: r.running,
      reportedAt: r.reported_at,
    }));
  const activityWindowRow = sql.exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'activity_window'`).toArray()[0];
  return {
    plan,
    machines,
    clients,
    approvals,
    relay,
    pushWindow: pushWindowOf(windowRow?.value),
    activityReports,
    activityWindow: pushWindowOf(activityWindowRow?.value),
  };
}
