/**
 * Conversation owner column (PAN-4645 WI-9, D-4645-19).
 *
 * `conversations.environment_id` names the machine that owns a row. Local rows
 * get this machine's environment id: at insert, from `localEnvironmentId()`
 * (set once at boot, before the server listens), and for rows from before the
 * column existed, from `backfillLocalConversationEnvironmentIds`, which fills
 * only NULLs on `origin = 'local'` rows and is therefore idempotent and needs no
 * marker. Vault browse copies get their owner's id from the browse manifest
 * (WI-10). `released_to` exists for #4650 and is never written here.
 *
 * The backfill runs on primary dashboards only: a peer shares another
 * dashboard's database and runs no data migration.
 */
import type { SqliteDatabase } from '../database/driver.js';
import { isPeerDashboardProcess } from '../boot-gates.js';
import { ensureEnvironmentIdentity } from '../environment-identity.js';
import { getOverdeckDatabase } from './infra.js';

let localId: string | null = null;

export function setLocalEnvironmentId(id: string): void {
  localId = id;
}

/** This machine's environment id once boot set it; null before that (rows then insert NULL). */
export function localEnvironmentId(): string | null {
  return localId;
}

/** Stamp every local row that has no owner yet. Returns the number of rows changed. */
export function backfillLocalConversationEnvironmentIds(db: SqliteDatabase, environmentId: string): number {
  const result = db
    .prepare("UPDATE conversations SET environment_id = ? WHERE environment_id IS NULL AND origin = 'local'")
    .run(environmentId);
  return Number(result.changes ?? 0);
}

/**
 * Boot step: read (or mint) the machine identity, make it the local id for
 * inserts, and on a primary dashboard backfill existing local rows.
 */
export async function bootConversationEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ environmentId: string; backfilled: number; skipped: 'peer' | null }> {
  const { environmentId } = await ensureEnvironmentIdentity();
  setLocalEnvironmentId(environmentId);
  if (isPeerDashboardProcess(env)) return { environmentId, backfilled: 0, skipped: 'peer' };
  return { environmentId, backfilled: backfillLocalConversationEnvironmentIds(getOverdeckDatabase(), environmentId), skipped: null };
}

export function _resetConversationEnvironmentForTests(): void {
  localId = null;
}

/**
 * Boot wrapper for main.ts: stamps local rows (`bootConversationEnvironment`)
 * and reports the outcome; a failure is logged and never stops the dashboard.
 * Sets the id for inserts on every dashboard; existing rows are backfilled on
 * the primary.
 */
export async function bootConversationEnvironmentOrWarn(): Promise<void> {
  try {
    const owner = await bootConversationEnvironment();
    if (owner.backfilled > 0) console.log(`[overdeck] Stamped ${owner.backfilled} local conversation(s) with environment ${owner.environmentId}`);
  } catch (err) {
    console.warn('[overdeck] Conversation owner column boot failed (non-fatal):', err);
  }
}
