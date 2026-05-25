import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { getPanopticonHome } from '../paths.js';
import type {
  FeatureRegistryEntry,
  FeatureRegistryListFilter,
  FeatureRegistryOwnershipUpdate,
  FeatureRegistryTagInput,
  FeatureRegistryUntagInput,
} from '@panctl/contracts';

export type {
  FeatureRegistryEntry,
  FeatureRegistryListFilter,
  FeatureRegistryOwnershipUpdate,
  FeatureRegistryTagInput,
  FeatureRegistryUntagInput,
} from '@panctl/contracts';

type FeatureRegistryOperation =
  | 'initialize'
  | 'list'
  | 'show'
  | 'tag'
  | 'untag'
  | 'updateOwnership';

interface FeatureRegistryWorkerResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { name?: string; message?: string; stack?: string };
}

let worker: Worker | null = null;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const betterSqlite3Path = resolveBetterSqlite3Path();

function resolveBetterSqlite3Path(): string {
  const requireFromModule = createRequire(import.meta.url);
  try {
    return requireFromModule.resolve('better-sqlite3');
  } catch (cause) {
    const error = new Error(
      `Cannot find better-sqlite3 from ${fileURLToPath(import.meta.url)}; run bun install in the workspace before starting Panopticon.`,
    );
    error.cause = cause;
    throw error;
  }
}

export function resolveFeatureRegistryDbPath(): string {
  return join(getPanopticonHome(), 'registry', 'features.sqlite');
}

export function initializeFeatureRegistryStorage(): Promise<void> {
  return runFeatureRegistryJob('initialize', undefined);
}

export function listFeatureRegistryEntries(filter: FeatureRegistryListFilter = {}): Promise<FeatureRegistryEntry[]> {
  return runFeatureRegistryJob('list', filter);
}

export function showFeatureRegistryFeature(featureName: string): Promise<FeatureRegistryEntry | null> {
  return runFeatureRegistryJob('show', { featureName });
}

export function tagFeatureRegistryIssue(input: FeatureRegistryTagInput): Promise<FeatureRegistryEntry> {
  return runFeatureRegistryJob('tag', input);
}

export function untagFeatureRegistryIssue(input: FeatureRegistryUntagInput): Promise<boolean> {
  return runFeatureRegistryJob('untag', input);
}

export function updateFeatureRegistryOwnership(input: FeatureRegistryOwnershipUpdate): Promise<FeatureRegistryEntry[]> {
  return runFeatureRegistryJob('updateOwnership', input);
}

export async function closeFeatureRegistryStorage(): Promise<void> {
  for (const request of pending.values()) request.reject(new Error('Feature registry worker closed'));
  pending.clear();
  const activeWorker = worker;
  worker = null;
  if (activeWorker) await activeWorker.terminate();
}

function runFeatureRegistryJob<T>(operation: FeatureRegistryOperation, payload: unknown): Promise<T> {
  const id = randomUUID();
  const activeWorker = getFeatureRegistryWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (value) => resolve(value as T), reject });
    activeWorker.postMessage({ id, operation, payload, dbPath: resolveFeatureRegistryDbPath() });
  });
}

function getFeatureRegistryWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(featureRegistryWorkerSource(), { eval: true, workerData: { betterSqlite3Path } });
  const activeWorker = worker;

  worker.on('message', (message: FeatureRegistryWorkerResponse) => {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) {
      request.resolve(message.result);
      return;
    }

    const error = new Error(message.error?.message ?? 'Feature registry worker failed');
    error.name = message.error?.name ?? 'FeatureRegistryWorkerError';
    error.stack = message.error?.stack;
    request.reject(error);
  });

  worker.on('error', (error) => {
    if (worker !== activeWorker) return;
    worker = null;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });

  worker.on('exit', (code) => {
    if (worker !== activeWorker) return;
    worker = null;
    if (code === 0) return;
    for (const request of pending.values()) request.reject(new Error(`Feature registry worker exited with code ${code}`));
    pending.clear();
  });

  return worker;
}

function featureRegistryWorkerSource(): string {
  return String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { dirname } = require('node:path');
const { mkdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const BetterSqlite3 = require(workerData.betterSqlite3Path);

const databases = new Map();
const STATUSES = new Set(['active', 'archived', 'merged', 'deferred']);

parentPort.on('message', (message) => {
  try {
    const db = databaseForPath(message.dbPath);
    const result = runOperation(db, message.operation, message.payload);
    parentPort.postMessage({ id: message.id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      id: message.id,
      ok: false,
      error: {
        name: error && error.name ? error.name : 'Error',
        message: error && error.message ? error.message : String(error),
        stack: error && error.stack ? error.stack : undefined,
      },
    });
  }
});

function databaseForPath(dbPath) {
  const cached = databases.get(dbPath);
  if (cached) return cached;
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('journal_size_limit = 67108864');
  initializeSchema(db);
  databases.set(dbPath, db);
  return db;
}

function initializeSchema(db) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS features (',
    '  feature_id TEXT PRIMARY KEY,',
    '  feature_name TEXT NOT NULL COLLATE NOCASE UNIQUE,',
    '  description TEXT,',
    '  owning_workspace_id TEXT,',
    '  owning_issue_id TEXT,',
    '  owning_agent_id TEXT,',
    '  status TEXT NOT NULL,',
    '  created_at TEXT NOT NULL,',
    '  updated_at TEXT NOT NULL,',
    '  tags TEXT',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_features_feature_name ON features(feature_name COLLATE NOCASE);',
    'CREATE INDEX IF NOT EXISTS idx_features_status ON features(status);',
    'CREATE INDEX IF NOT EXISTS idx_features_owning_issue_id ON features(owning_issue_id);',
    'CREATE INDEX IF NOT EXISTS idx_features_owning_workspace_id ON features(owning_workspace_id);',
    'CREATE INDEX IF NOT EXISTS idx_features_owning_agent_id ON features(owning_agent_id);',
  ].join('\n'));
}

function runOperation(db, operation, payload) {
  switch (operation) {
    case 'initialize':
      initializeSchema(db);
      return null;
    case 'list':
      return listFeatures(db, payload || {});
    case 'show':
      return showFeature(db, requireFeatureName(payload && payload.featureName));
    case 'tag':
      return tagIssue(db, payload || {});
    case 'untag':
      return untagIssue(db, payload || {});
    case 'updateOwnership':
      return updateOwnership(db, payload || {});
    default:
      throw new Error('Unknown feature registry operation: ' + operation);
  }
}

function listFeatures(db, filter) {
  const clauses = [];
  const params = [];

  if (filter.featureName) {
    clauses.push('feature_name = ? COLLATE NOCASE');
    params.push(requireFeatureName(filter.featureName));
  }
  if (filter.issueId) {
    clauses.push('owning_issue_id = ?');
    params.push(normalizeIssueId(filter.issueId));
  }
  if (filter.workspaceId) {
    clauses.push('owning_workspace_id = ?');
    params.push(filter.workspaceId);
  }
  if (filter.agentId) {
    clauses.push('owning_agent_id = ?');
    params.push(filter.agentId);
  }
  if (filter.status) {
    clauses.push('status = ?');
    params.push(normalizeStatus(filter.status));
  }

  const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? Math.min(filter.limit, 500) : 500;
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare([
    'SELECT feature_id, feature_name, description, owning_workspace_id, owning_issue_id, owning_agent_id, status, created_at, updated_at, tags',
    'FROM features',
    where,
    'ORDER BY updated_at DESC, feature_name ASC',
    'LIMIT ?',
  ].join('\n')).all(...params, limit);

  const entries = rows.map(rowToEntry);
  if (!Array.isArray(filter.tags) || filter.tags.length === 0) return entries;
  const requiredTags = normalizeTags(filter.tags);
  return entries.filter((entry) => requiredTags.every((tag) => entry.tags.includes(tag)));
}

function showFeature(db, featureName) {
  const row = db.prepare([
    'SELECT feature_id, feature_name, description, owning_workspace_id, owning_issue_id, owning_agent_id, status, created_at, updated_at, tags',
    'FROM features',
    'WHERE feature_name = ? COLLATE NOCASE',
  ].join('\n')).get(featureName);
  return row ? rowToEntry(row) : null;
}

function tagIssue(db, input) {
  const featureName = requireFeatureName(input.featureName);
  const issueId = normalizeIssueId(input.issueId);
  const now = input.now || new Date().toISOString();
  const existing = showFeature(db, featureName);
  const tags = input.tags === undefined ? existing ? existing.tags : [] : mergeTags(existing ? existing.tags : [], input.tags);
  const description = input.description === undefined
    ? existing ? existing.description : null
    : normalizeNullableString(input.description);
  const status = normalizeStatus(input.status || (existing ? existing.status : 'active'));

  db.prepare([
    'INSERT INTO features (',
    '  feature_id, feature_name, description, owning_workspace_id, owning_issue_id, owning_agent_id, status, created_at, updated_at, tags',
    ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'ON CONFLICT(feature_name) DO UPDATE SET',
    '  feature_name = excluded.feature_name,',
    '  description = excluded.description,',
    '  owning_workspace_id = excluded.owning_workspace_id,',
    '  owning_issue_id = excluded.owning_issue_id,',
    '  owning_agent_id = excluded.owning_agent_id,',
    '  status = excluded.status,',
    '  updated_at = excluded.updated_at,',
    '  tags = excluded.tags',
  ].join('\n')).run(
    existing ? existing.featureId : randomUUID(),
    featureName,
    description,
    fieldOrNull(input, 'workspaceId'),
    issueId,
    fieldOrNull(input, 'agentId'),
    status,
    existing ? existing.createdAt : now,
    now,
    JSON.stringify(tags),
  );

  return showFeature(db, featureName);
}

function untagIssue(db, input) {
  const featureName = requireFeatureName(input.featureName);
  const issueId = normalizeIssueId(input.issueId);
  const result = db.prepare([
    'DELETE FROM features',
    'WHERE feature_name = ? COLLATE NOCASE',
    '  AND owning_issue_id = ?',
  ].join('\n')).run(featureName, issueId);
  return result.changes > 0;
}

function updateOwnership(db, input) {
  const where = [];
  const whereParams = [];
  if (input.featureName !== undefined) {
    where.push('feature_name = ? COLLATE NOCASE');
    whereParams.push(requireFeatureName(input.featureName));
  } else if (input.issueId !== undefined && input.issueId !== null) {
    where.push('owning_issue_id = ?');
    whereParams.push(normalizeIssueId(input.issueId));
  } else if (input.workspaceId !== undefined && input.workspaceId !== null) {
    where.push('owning_workspace_id = ?');
    whereParams.push(input.workspaceId);
  } else if (input.agentId !== undefined && input.agentId !== null) {
    where.push('owning_agent_id = ?');
    whereParams.push(input.agentId);
  } else {
    throw new Error('Feature registry ownership update requires featureName, issueId, workspaceId, or agentId');
  }

  const now = input.now || new Date().toISOString();
  const updates = ['updated_at = ?'];
  const updateParams = [now];
  if (Object.prototype.hasOwnProperty.call(input, 'issueId')) {
    updates.push('owning_issue_id = ?');
    updateParams.push(input.issueId === null ? null : normalizeIssueId(input.issueId));
  }
  if (Object.prototype.hasOwnProperty.call(input, 'workspaceId')) {
    updates.push('owning_workspace_id = ?');
    updateParams.push(input.workspaceId === undefined ? null : input.workspaceId);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'agentId')) {
    updates.push('owning_agent_id = ?');
    updateParams.push(input.agentId === undefined ? null : input.agentId);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'status')) {
    updates.push('status = ?');
    updateParams.push(normalizeStatus(input.status));
  }
  if (Object.prototype.hasOwnProperty.call(input, 'tags')) {
    updates.push('tags = ?');
    updateParams.push(JSON.stringify(normalizeTags(input.tags || [])));
  }

  db.prepare('UPDATE features SET ' + updates.join(', ') + ' WHERE ' + where.join(' AND ')).run(...updateParams, ...whereParams);
  return listFeatures(db, whereToFilter(input));
}

function whereToFilter(input) {
  if (input.featureName !== undefined) return { featureName: input.featureName };
  if (input.issueId !== undefined && input.issueId !== null) return { issueId: input.issueId };
  if (input.workspaceId !== undefined && input.workspaceId !== null) return { workspaceId: input.workspaceId };
  if (input.agentId !== undefined && input.agentId !== null) return { agentId: input.agentId };
  return {};
}

function rowToEntry(row) {
  return {
    featureId: row.feature_id,
    featureName: row.feature_name,
    description: row.description,
    owningWorkspaceId: row.owning_workspace_id,
    owningIssueId: row.owning_issue_id,
    owningAgentId: row.owning_agent_id,
    status: normalizeStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags: parseTags(row.tags),
  };
}

function requireFeatureName(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('featureName is required');
  return value.trim();
}

function normalizeIssueId(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('issueId is required');
  return value.trim().toUpperCase();
}

function normalizeStatus(value) {
  if (!STATUSES.has(value)) throw new Error('Invalid feature registry status: ' + value);
  return value;
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length === 0 ? null : trimmed;
}

function fieldOrNull(input, field) {
  if (!Object.prototype.hasOwnProperty.call(input, field)) return null;
  return input[field] === undefined ? null : input[field];
}

function parseTags(value) {
  if (!value) return [];
  try {
    return normalizeTags(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const tags = [];
  for (const item of value) {
    const tag = String(item).trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function mergeTags(existing, incoming) {
  return normalizeTags([...(existing || []), ...(incoming || [])]);
}
`;
}
