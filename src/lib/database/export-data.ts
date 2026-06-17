/**
 * Data export / import for the Overdeck cutover (PAN-1937).
 *
 * Produces a portable bundle of the two non-derivable tables:
 *   - conversations (core metadata)
 *   - favorites (conversation bookmarks)
 *
 * The cost ledger is written as a separate, decoupled artifact so it can be
 * included or omitted without affecting the core import.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getDatabase } from './index.js';
import type { SqliteDatabase } from './driver.js';

export interface ExportBundle {
  conversations: ConversationExportRow[];
  favorites: FavoriteExportRow[];
}

export interface ConversationExportRow {
  name: string;
  tmuxSession: string;
  title: string | null;
  titleSeed: string | null;
  issueId: string | null;
  claudeSessionId: string | null;
  cwd: string;
  model: string | null;
  effort: string | null;
  harness: string | null;
  createdAt: string;
  endedAt: string | null;
  archivedAt: string | null;
  forkStatus: string | null;
  handoffTargetConvName: string | null;
  clearedToConvName: string | null;
  handoffDocPath: string | null;
}

export interface FavoriteExportRow {
  type: string;
  itemId: string;
  createdAt: string;
}

export interface CostLedgerExportRow {
  ts: string;
  agentId: string;
  issueId: string;
  sessionType: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface ExportResult {
  coreBundle: ExportBundle;
  costLedger: CostLedgerExportRow[];
  bundledJsonlPaths: string[];
}

interface DbConversationRow {
  name: string;
  tmux_session: string;
  title: string | null;
  title_seed: string | null;
  issue_id: string | null;
  claude_session_id: string | null;
  cwd: string;
  model: string | null;
  effort: string | null;
  harness: string | null;
  created_at: string;
  ended_at: string | null;
  archived_at: string | null;
  fork_status: string | null;
  handoff_doc_path: string | null;
  handoff_target_conv_id: number | null;
  cleared_to_conv_id: number | null;
}

interface DbCostRow {
  ts: string;
  agent_id: string;
  issue_id: string;
  session_type: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cost: number;
}

const CORE_COLUMNS = [
  'name', 'tmux_session', 'title', 'title_seed', 'issue_id', 'claude_session_id', 'cwd',
  'model', 'effort', 'harness', 'created_at', 'ended_at', 'archived_at',
  'fork_status', 'handoff_doc_path', 'handoff_target_conv_id', 'cleared_to_conv_id',
];

function conversationById(db: SqliteDatabase, id: number): { name: string } | undefined {
  return db.prepare('SELECT name FROM conversations WHERE id = ?').get(id) as { name: string } | undefined;
}

function isSeedRow(row: CostLedgerExportRow): boolean {
  // Pre-2025-12 seed rows use generic agent ids and backdated timestamps.
  if (/^agent-[^-]+$/i.test(row.agentId)) return true;
  if (row.ts && row.ts < '2025-12-01T00:00:00.000Z') return true;
  return false;
}

function getDefaultExportDir(): string {
  return join(homedir(), '.panopticon', 'exports');
}

function mapCostRow(raw: DbCostRow): CostLedgerExportRow {
  return {
    ts: raw.ts,
    agentId: raw.agent_id,
    issueId: raw.issue_id,
    sessionType: raw.session_type,
    provider: raw.provider,
    model: raw.model,
    input: raw.input,
    output: raw.output,
    cacheRead: raw.cache_read,
    cacheWrite: raw.cache_write,
    cost: raw.cost,
  };
}

/**
 * Export non-derivable conversation + favorite data and the decoupled cost ledger.
 *
 * @param options.includeCostLedger whether to include cost_events in the result
 * @param options.bundleJsonl whether to also collect paths to transcript JSONL files
 */
export function exportData(options: {
  includeCostLedger?: boolean;
  bundleJsonl?: boolean;
} = {}): ExportResult {
  const db = getDatabase();

  const conversationRows = db
    .prepare(`SELECT ${CORE_COLUMNS.join(', ')} FROM conversations`)
    .all() as DbConversationRow[];

  const conversations: ConversationExportRow[] = conversationRows.map((row) => ({
    name: row.name,
    tmuxSession: row.tmux_session,
    title: row.title,
    titleSeed: row.title_seed,
    issueId: row.issue_id,
    claudeSessionId: row.claude_session_id,
    cwd: row.cwd,
    model: row.model,
    effort: row.effort,
    harness: row.harness,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    archivedAt: row.archived_at,
    forkStatus: row.fork_status,
    handoffDocPath: row.handoff_doc_path,
    handoffTargetConvName: row.handoff_target_conv_id
      ? (conversationById(db, row.handoff_target_conv_id)?.name ?? null)
      : null,
    clearedToConvName: row.cleared_to_conv_id
      ? (conversationById(db, row.cleared_to_conv_id)?.name ?? null)
      : null,
  }));

  interface DbFavoriteRow {
    type: string;
    item_id: string;
    created_at: string;
  }

  const favoriteRows = (db
    .prepare('SELECT type, item_id, created_at FROM favorites')
    .all() as DbFavoriteRow[]
  ).map((raw) => ({
    type: raw.type,
    itemId: raw.item_id,
    createdAt: raw.created_at,
  }));

  const bundledJsonlPaths: string[] = [];
  if (options.bundleJsonl) {
    for (const row of conversationRows) {
      if (row.claude_session_id) {
        const jsonlPath = join(homedir(), '.claude', 'projects', encodeClaudeProjectDir(row.cwd), `${row.claude_session_id}.jsonl`);
        if (existsSync(jsonlPath)) {
          bundledJsonlPaths.push(jsonlPath);
        }
      }
    }
  }

  const costLedger: CostLedgerExportRow[] = [];
  if (options.includeCostLedger) {
    const rawCosts = db
      .prepare(`SELECT ts, agent_id, issue_id, session_type, provider, model, input, output, cache_read, cache_write, cost
                FROM cost_events`)
      .all() as DbCostRow[];
    for (const raw of rawCosts) {
      const row = mapCostRow(raw);
      if (!isSeedRow(row)) costLedger.push(row);
    }
  }

  return {
    coreBundle: { conversations, favorites: favoriteRows },
    costLedger,
    bundledJsonlPaths,
  };
}

export interface WriteBundleResult {
  corePath: string;
  costLedgerPath: string | null;
}

/**
 * Write the export bundle to disk. Returns the paths written.
 */
export function writeExportBundle(result: ExportResult, exportDir = getDefaultExportDir()): WriteBundleResult {
  mkdirSync(exportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const corePath = join(exportDir, `panopticon-export-core-${timestamp}.json`);
  writeFileSync(corePath, JSON.stringify(result.coreBundle, null, 2) + '\n', 'utf8');

  let costLedgerPath: string | null = null;
  if (result.costLedger.length > 0) {
    costLedgerPath = join(exportDir, `panopticon-export-cost-ledger-${timestamp}.jsonl`);
    const lines = result.costLedger.map((row) => JSON.stringify(row)).join('\n') + '\n';
    writeFileSync(costLedgerPath, lines, 'utf8');
  }

  return { corePath, costLedgerPath };
}

/**
 * Import a core bundle (conversations + favorites). Existing rows with the same
 * primary key are replaced so re-importing is idempotent.
 */
export function importCoreBundle(bundle: ExportBundle): { conversationsImported: number; favoritesImported: number } {
  const db = getDatabase();
  const nameToId = new Map<string, number>();

  const insertConv = db.prepare(`
    INSERT OR REPLACE INTO conversations (
      name, tmux_session, title, title_seed, issue_id, claude_session_id, cwd,
      model, effort, harness, created_at, ended_at, archived_at,
      fork_status, handoff_doc_path, handoff_target_conv_id, cleared_to_conv_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of bundle.conversations) {
    // Resolve handoff/cleared references by name after all conversations are inserted.
    const result = insertConv.run(
      row.name,
      row.tmuxSession,
      row.title ?? null,
      row.titleSeed ?? null,
      row.issueId ?? null,
      row.claudeSessionId ?? null,
      row.cwd,
      row.model ?? null,
      row.effort ?? null,
      row.harness ?? null,
      row.createdAt,
      row.endedAt ?? null,
      row.archivedAt ?? null,
      row.forkStatus ?? null,
      row.handoffDocPath ?? null,
      null,
      null,
    );
    nameToId.set(row.name, result.lastInsertRowid as number);
  }

  const updateHandoffTarget = db.prepare(`
    UPDATE conversations SET handoff_target_conv_id = ? WHERE id = ?
  `);
  const updateClearedTo = db.prepare(`
    UPDATE conversations SET cleared_to_conv_id = ? WHERE id = ?
  `);

  for (const row of bundle.conversations) {
    const id = nameToId.get(row.name);
    if (id === undefined) continue;
    const numericId = Number(id);
    if (row.handoffTargetConvName) {
      const handoffTargetId = nameToId.get(row.handoffTargetConvName);
      if (handoffTargetId !== undefined) {
        updateHandoffTarget.run(handoffTargetId, numericId);
      }
    }
    if (row.clearedToConvName) {
      const clearedToId = nameToId.get(row.clearedToConvName);
      if (clearedToId !== undefined) {
        updateClearedTo.run(clearedToId, numericId);
      }
    }
  }

  const insertFav = db.prepare(`
    INSERT OR IGNORE INTO favorites (type, item_id, created_at) VALUES (?, ?, ?)
  `);
  for (const row of bundle.favorites) {
    insertFav.run(row.type, row.itemId, row.createdAt);
  }

  return {
    conversationsImported: bundle.conversations.length,
    favoritesImported: bundle.favorites.length,
  };
}

/**
 * Import a cost ledger from a JSONL file. Fully decoupled from conversations.
 */
export function importCostLedger(path: string): { imported: number; duplicates: number } {
  const db = getDatabase();
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n').filter((line) => line.trim());

  const insert = db.prepare(`
    INSERT OR IGNORE INTO cost_events (
      ts, agent_id, issue_id, session_type, provider, model,
      input, output, cache_read, cache_write, cost
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let imported = 0;
  let duplicates = 0;

  for (const line of lines) {
    const row = JSON.parse(line) as CostLedgerExportRow;
    if (isSeedRow(row)) continue;
    const result = insert.run(
      row.ts,
      row.agentId,
      row.issueId,
      row.sessionType,
      row.provider,
      row.model,
      row.input,
      row.output,
      row.cacheRead,
      row.cacheWrite,
      row.cost,
    );
    if (result.changes > 0) imported++;
    else duplicates++;
  }

  return { imported, duplicates };
}

// Re-use the same encoder as paths.ts so JSONL lookup is consistent.
function encodeClaudeProjectDir(cwdPath: string): string {
  return cwdPath.replace(/[^a-zA-Z0-9-]/g, '-');
}
