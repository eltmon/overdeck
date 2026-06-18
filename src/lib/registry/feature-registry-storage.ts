import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openDatabase, type SqliteDatabase, type SqliteBindValue } from '../database/driver.js';
import { getOverdeckHome } from '../paths.js';
import type {
  FeatureRegistryEntry,
  FeatureRegistryListFilter,
  FeatureRegistryOwnershipUpdate,
  FeatureRegistryTagInput,
  FeatureRegistryUntagInput,
} from '@overdeck/contracts';

export type {
  FeatureRegistryEntry,
  FeatureRegistryListFilter,
  FeatureRegistryOwnershipUpdate,
  FeatureRegistryTagInput,
  FeatureRegistryUntagInput,
} from '@overdeck/contracts';

type FeatureRegistryOperation =
  | 'initialize'
  | 'list'
  | 'show'
  | 'tag'
  | 'untag'
  | 'updateOwnership';

type FeatureRegistryStatus = FeatureRegistryEntry['status'];

interface FeatureRegistryRow {
  feature_id: string;
  feature_name: string;
  description: string | null;
  owning_workspace_id: string | null;
  owning_issue_id: string | null;
  owning_agent_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  tags: string | null;
}

const databases = new Map<string, SqliteDatabase>();
const STATUSES = new Set<FeatureRegistryStatus>(['active', 'archived', 'merged', 'deferred']);

export function resolveFeatureRegistryDbPath(): string {
  return join(getOverdeckHome(), 'registry', 'features.sqlite');
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
  for (const database of databases.values()) database.close();
  databases.clear();
}

async function runFeatureRegistryJob<T>(operation: FeatureRegistryOperation, payload: unknown): Promise<T> {
  const db = databaseForPath(resolveFeatureRegistryDbPath());
  return runOperation(db, operation, payload) as T;
}

function databaseForPath(dbPath: string): SqliteDatabase {
  const cached = databases.get(dbPath);
  if (cached) return cached;

  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('journal_size_limit = 67108864');
  initializeSchema(db);
  databases.set(dbPath, db);
  return db;
}

function initializeSchema(db: SqliteDatabase): void {
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

function runOperation(db: SqliteDatabase, operation: FeatureRegistryOperation, payload: unknown): unknown {
  switch (operation) {
    case 'initialize':
      initializeSchema(db);
      return undefined;
    case 'list':
      return listFeatures(db, (payload || {}) as FeatureRegistryListFilter);
    case 'show':
      return showFeature(db, requireFeatureName((payload as { featureName?: unknown } | undefined)?.featureName));
    case 'tag':
      return tagIssue(db, (payload || {}) as Partial<FeatureRegistryTagInput>);
    case 'untag':
      return untagIssue(db, (payload || {}) as Partial<FeatureRegistryUntagInput>);
    case 'updateOwnership':
      return updateOwnership(db, (payload || {}) as Partial<FeatureRegistryOwnershipUpdate>);
  }
}

function listFeatures(db: SqliteDatabase, filter: FeatureRegistryListFilter): FeatureRegistryEntry[] {
  const clauses: string[] = [];
  const params: SqliteBindValue[] = [];

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

  const limit = typeof filter.limit === 'number' && Number.isInteger(filter.limit) && filter.limit > 0
    ? Math.min(filter.limit, 500)
    : 500;
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare([
    'SELECT feature_id, feature_name, description, owning_workspace_id, owning_issue_id, owning_agent_id, status, created_at, updated_at, tags',
    'FROM features',
    where,
    'ORDER BY updated_at DESC, feature_name ASC',
    'LIMIT ?',
  ].join('\n')).all(...params, limit) as unknown as FeatureRegistryRow[];

  const entries = rows.map(rowToEntry);
  if (!Array.isArray(filter.tags) || filter.tags.length === 0) return entries;
  const requiredTags = normalizeTags(filter.tags);
  return entries.filter((entry) => requiredTags.every((tag) => entry.tags.includes(tag)));
}

function showFeature(db: SqliteDatabase, featureName: string): FeatureRegistryEntry | null {
  const row = db.prepare([
    'SELECT feature_id, feature_name, description, owning_workspace_id, owning_issue_id, owning_agent_id, status, created_at, updated_at, tags',
    'FROM features',
    'WHERE feature_name = ? COLLATE NOCASE',
  ].join('\n')).get(featureName) as unknown as FeatureRegistryRow | undefined;
  return row ? rowToEntry(row) : null;
}

function tagIssue(db: SqliteDatabase, input: Partial<FeatureRegistryTagInput>): FeatureRegistryEntry {
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

  const tagged = showFeature(db, featureName);
  if (!tagged) throw new Error(`Feature registry tag failed for ${featureName}`);
  return tagged;
}

function untagIssue(db: SqliteDatabase, input: Partial<FeatureRegistryUntagInput>): boolean {
  const featureName = requireFeatureName(input.featureName);
  const issueId = normalizeIssueId(input.issueId);
  const result = db.prepare([
    'DELETE FROM features',
    'WHERE feature_name = ? COLLATE NOCASE',
    '  AND owning_issue_id = ?',
  ].join('\n')).run(featureName, issueId);
  return result.changes > 0;
}

function updateOwnership(db: SqliteDatabase, input: Partial<FeatureRegistryOwnershipUpdate>): FeatureRegistryEntry[] {
  const where: string[] = [];
  const whereParams: SqliteBindValue[] = [];
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
  const updateParams: SqliteBindValue[] = [now];
  if (Object.prototype.hasOwnProperty.call(input, 'issueId')) {
    updates.push('owning_issue_id = ?');
    updateParams.push(input.issueId === null || input.issueId === undefined ? null : normalizeIssueId(input.issueId));
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

function whereToFilter(input: Partial<FeatureRegistryOwnershipUpdate>): FeatureRegistryListFilter {
  if (input.featureName !== undefined) return { featureName: input.featureName };
  if (input.issueId !== undefined && input.issueId !== null) return { issueId: input.issueId };
  if (input.workspaceId !== undefined && input.workspaceId !== null) return { workspaceId: input.workspaceId };
  if (input.agentId !== undefined && input.agentId !== null) return { agentId: input.agentId };
  return {};
}

function rowToEntry(row: FeatureRegistryRow): FeatureRegistryEntry {
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

function requireFeatureName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('featureName is required');
  return value.trim();
}

function normalizeIssueId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('issueId is required');
  return value.trim().toUpperCase();
}

function normalizeStatus(value: unknown): FeatureRegistryStatus {
  if (!STATUSES.has(value as FeatureRegistryStatus)) throw new Error('Invalid feature registry status: ' + String(value));
  return value as FeatureRegistryStatus;
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length === 0 ? null : trimmed;
}

function fieldOrNull<T extends 'workspaceId' | 'agentId'>(
  input: Partial<Pick<FeatureRegistryTagInput, T>>,
  field: T,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(input, field)) return null;
  return input[field] === undefined ? null : input[field] ?? null;
}

function parseTags(value: string | null): string[] {
  if (!value) return [];
  try {
    return normalizeTags(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    const tag = String(item).trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function mergeTags(existing: readonly string[] | undefined, incoming: unknown): string[] {
  return normalizeTags([...(existing || []), ...normalizeTags(incoming)]);
}
