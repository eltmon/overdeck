import { existsSync } from 'node:fs';
import { openDatabase } from '../database/driver.js';
import {
  getConversationByName,
  getConversationByClaudeSessionId,
  isAgentConversationName,
  importLegacyConversation,
  setImportedConversationLinks,
  setFavorite,
} from './conversations.js';

export interface PreviewRow {
  name: string;
  title: string | null;
  createdAt: string;
  model: string | null;
  lastActivityAt: string | null;
  messageCount: number | null;
  hasFavorite: boolean;
  claudeSessionId: string | null;
  alreadyImported: boolean;
}

export interface PreviewResult {
  found: true;
  rows: PreviewRow[];
}

export interface PreviewNotFound {
  found: false;
}

export function previewLegacyConversations(path: string): PreviewResult | PreviewNotFound {
  if (!existsSync(path)) {
    return { found: false };
  }

  const db = openDatabase(path, { readOnly: true });
  try {
    const legacyRows = db
      .prepare(
        `SELECT name, title, created_at, model, last_attached_at, claude_session_id
         FROM conversations
         ORDER BY created_at DESC`,
      )
      .all() as {
        name: string;
        title: string | null;
        created_at: string;
        model: string | null;
        last_attached_at: string | null;
        claude_session_id: string | null;
      }[];

    const favSet = new Set<string>(
      (
        db
          .prepare(`SELECT item_id FROM favorites WHERE type = 'conversation'`)
          .all() as { item_id: string }[]
      ).map((r) => r.item_id),
    );

    const rows: PreviewRow[] = [];
    for (const row of legacyRows) {
      if (isAgentConversationName(row.name)) continue;
      rows.push({
        name: row.name,
        title: row.title,
        createdAt: row.created_at,
        model: row.model,
        lastActivityAt: row.last_attached_at,
        messageCount: null,
        hasFavorite: favSet.has(row.name),
        claudeSessionId: row.claude_session_id,
        alreadyImported: getConversationByName(row.name) !== null,
      });
    }

    return { found: true, rows };
  } finally {
    db.close();
  }
}

export interface ImportResult {
  imported: string[];
  skipped: { name: string; reason: string }[];
  failed: { name: string; reason: string }[];
  warnings: { name: string; reason: string }[];
  favoritesCarried: number;
}

type LegacyRow = {
  id: number;
  name: string;
  tmux_session: string | null;
  status: string | null;
  cwd: string;
  created_at: string | null;
  ended_at: string | null;
  last_attached_at: string | null;
  session_file: string | null;
  claude_session_id: string | null;
  title: string | null;
  title_source: string | null;
  title_seed: string | null;
  total_cost: number | null;
  total_tokens: number | null;
  archived_at: string | null;
  model: string | null;
  effort: string | null;
  fork_status: string | null;
  fork_error: string | null;
  harness: string | null;
  delivery_method: string | null;
  spawn_error: string | null;
  handoff_doc_path: string | null;
  handoff_target_conv_id: number | null;
  fork_fallback_reason: string | null;
  cleared_to_conv_id: number | null;
  fork_request: string | null;
  fork_retry_count: number | null;
};

// Every column importLegacyConversations would like to read from the legacy
// source DB. The legacy panopticon.db is a frozen, read-only artifact whose
// schema vintage varies — older files predate later columns (e.g. fork_request,
// fork_retry_count). We select only the columns that actually exist and treat
// absent ones as null, so the import never throws "no such column".
const LEGACY_CONVERSATION_COLUMNS = [
  'id', 'name', 'tmux_session', 'status', 'cwd', 'created_at', 'ended_at', 'last_attached_at',
  'session_file', 'claude_session_id', 'title', 'title_source', 'title_seed',
  'total_cost', 'total_tokens', 'archived_at', 'model', 'effort', 'fork_status', 'fork_error',
  'harness', 'delivery_method', 'spawn_error', 'handoff_doc_path', 'handoff_target_conv_id',
  'fork_fallback_reason', 'cleared_to_conv_id', 'fork_request', 'fork_retry_count',
] as const;

// Coalesce a raw row (only the columns that existed in the legacy DB) into a
// complete LegacyRow, defaulting any column absent from this DB's schema to null.
function normalizeLegacyRow(row: Partial<LegacyRow>): LegacyRow {
  return {
    id: row.id as number,
    name: row.name as string,
    tmux_session: row.tmux_session ?? null,
    status: row.status ?? null,
    cwd: row.cwd ?? '',
    created_at: row.created_at ?? null,
    ended_at: row.ended_at ?? null,
    last_attached_at: row.last_attached_at ?? null,
    session_file: row.session_file ?? null,
    claude_session_id: row.claude_session_id ?? null,
    title: row.title ?? null,
    title_source: row.title_source ?? null,
    title_seed: row.title_seed ?? null,
    total_cost: row.total_cost ?? null,
    total_tokens: row.total_tokens ?? null,
    archived_at: row.archived_at ?? null,
    model: row.model ?? null,
    effort: row.effort ?? null,
    fork_status: row.fork_status ?? null,
    fork_error: row.fork_error ?? null,
    harness: row.harness ?? null,
    delivery_method: row.delivery_method ?? null,
    spawn_error: row.spawn_error ?? null,
    handoff_doc_path: row.handoff_doc_path ?? null,
    handoff_target_conv_id: row.handoff_target_conv_id ?? null,
    fork_fallback_reason: row.fork_fallback_reason ?? null,
    cleared_to_conv_id: row.cleared_to_conv_id ?? null,
    fork_request: row.fork_request ?? null,
    fork_retry_count: row.fork_retry_count ?? null,
  };
}

function parseIsoToMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function importLegacyConversations(path: string, names: string[]): ImportResult {
  const result: ImportResult = {
    imported: [],
    skipped: [],
    failed: [],
    warnings: [],
    favoritesCarried: 0,
  };

  if (!existsSync(path) || names.length === 0) return result;

  const db = openDatabase(path, { readOnly: true });
  let legacyRows: LegacyRow[];
  let favSet: Set<string>;
  try {
    const existingCols = new Set(
      (db.prepare(`PRAGMA table_info(conversations)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    const selectCols = LEGACY_CONVERSATION_COLUMNS.filter((c) => existingCols.has(c));
    const placeholders = names.map(() => '?').join(', ');
    const rawRows = db
      .prepare(
        `SELECT ${selectCols.join(', ')}
         FROM conversations WHERE name IN (${placeholders})`,
      )
      .all(...names) as Partial<LegacyRow>[];
    legacyRows = rawRows.map(normalizeLegacyRow);

    favSet = new Set<string>(
      (
        db
          .prepare(`SELECT item_id FROM favorites WHERE type = 'conversation'`)
          .all() as { item_id: string }[]
      ).map((r) => r.item_id),
    );
  } finally {
    db.close();
  }

  // legacyRowid → new UUID for pass-2 FK remap
  const rowidToUuid = new Map<number, string>();

  // pass 1: insert non-existing rows
  for (const row of legacyRows) {
    if (isAgentConversationName(row.name)) {
      result.skipped.push({ name: row.name, reason: 'agent/planning/specialist conversation excluded from import' });
      continue;
    }

    const createdAtMs = parseIsoToMs(row.created_at);
    if (createdAtMs === null) {
      result.failed.push({ name: row.name, reason: `unparseable created_at: ${String(row.created_at)}` });
      continue;
    }

    if (getConversationByName(row.name) !== null) {
      result.skipped.push({ name: row.name, reason: 'name already exists in overdeck.db' });
      continue;
    }
    if (row.claude_session_id && getConversationByClaudeSessionId(row.claude_session_id) !== null) {
      result.skipped.push({ name: row.name, reason: 'claude_session_id already registered in overdeck.db' });
      continue;
    }

    const archivedAtMs = parseIsoToMs(row.archived_at);
    const status = (row.status as 'active' | 'ended' | null) ?? (archivedAtMs ? 'ended' : 'active');

    const { uuid } = importLegacyConversation({
      name: row.name,
      tmuxSession: row.tmux_session,
      status,
      cwd: row.cwd,
      createdAt: createdAtMs,
      endedAt: parseIsoToMs(row.ended_at),
      lastAttachedAt: parseIsoToMs(row.last_attached_at),
      sessionFile: row.session_file,
      claudeSessionId: row.claude_session_id,
      title: row.title,
      titleSource: row.title_source,
      titleSeed: row.title_seed,
      totalCost: row.total_cost ?? 0,
      totalTokens: row.total_tokens ?? 0,
      archivedAt: archivedAtMs,
      model: row.model,
      effort: row.effort,
      forkStatus: row.fork_status,
      forkError: row.fork_error,
      harness: row.harness,
      deliveryMethod: row.delivery_method,
      spawnError: row.spawn_error,
      handoffDocPath: row.handoff_doc_path,
      forkFallbackReason: row.fork_fallback_reason,
      forkRequest: row.fork_request,
      forkRetryCount: row.fork_retry_count ?? 0,
    });

    rowidToUuid.set(row.id, uuid);
    result.imported.push(row.name);

    if (favSet.has(row.name)) {
      setFavorite('conversation', row.name);
      result.favoritesCarried++;
    }
  }

  // pass 2: remap FK columns
  for (const row of legacyRows) {
    const uuid = rowidToUuid.get(row.id);
    if (!uuid) continue;

    const handoffTargetUuid = row.handoff_target_conv_id != null
      ? (rowidToUuid.get(row.handoff_target_conv_id) ?? null)
      : null;
    const clearedToUuid = row.cleared_to_conv_id != null
      ? (rowidToUuid.get(row.cleared_to_conv_id) ?? null)
      : null;

    if (row.handoff_target_conv_id != null && handoffTargetUuid === null) {
      result.warnings.push({ name: row.name, reason: `handoff target (legacy rowid ${row.handoff_target_conv_id}) was not imported; handoff_target_conv_id set to NULL` });
    }
    if (row.cleared_to_conv_id != null && clearedToUuid === null) {
      result.warnings.push({ name: row.name, reason: `cleared_to target (legacy rowid ${row.cleared_to_conv_id}) was not imported; cleared_to_conv_id set to NULL` });
    }

    if (handoffTargetUuid !== null || clearedToUuid !== null) {
      setImportedConversationLinks(uuid, { handoffTargetUuid, clearedToUuid });
    }
  }

  return result;
}
