import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ArtifactLifecycleState, ArtifactMetadata } from '@overdeck/contracts';
import { openDatabase, type SqliteDatabase } from '../database/driver.js';
import { getPanopticonHome } from '../paths.js';

export interface ArtifactIndexOptions {
  dbPath?: string;
  now?: () => string;
  slugGenerator?: () => string;
  maxSlugAttempts?: number;
}

export interface CreateArtifactInput {
  artifactId: string;
  filePath: string;
  currentHash: string;
  slug?: string;
  issueId?: string | null;
  workspaceId?: string | null;
  agentRole?: ArtifactMetadata['agentRole'];
  agentHarness?: ArtifactMetadata['agentHarness'];
  runId?: string | null;
  sessionId?: string | null;
  lastPublishedHash?: string | null;
  supersedes?: string | null;
  title?: string | null;
  description?: string | null;
  createdAt?: string;
  publishedAt?: string | null;
  unsharedAt?: string | null;
}

export interface ArtifactIndexEntry {
  artifact: ArtifactMetadata;
  status: ArtifactLifecycleState;
  pendingChanges: boolean;
}

interface ArtifactRow {
  artifact_id: string;
  slug: string;
  issue_id: string | null;
  workspace_id: string | null;
  agent_role: ArtifactMetadata['agentRole'] | null;
  agent_harness: ArtifactMetadata['agentHarness'] | null;
  run_id: string | null;
  session_id: string | null;
  file_path: string;
  current_hash: string;
  last_published_hash: string | null;
  supersedes: string | null;
  title: string | null;
  description: string | null;
  created_at: string;
  published_at: string | null;
  unshared_at: string | null;
}

const SLUG_PATTERN = /^[A-Za-z0-9_-]{8}$/;

export function getArtifactsDir(): string {
  return join(getPanopticonHome(), 'artifacts');
}

export function getArtifactIndexPath(): string {
  return join(getArtifactsDir(), 'index.sqlite');
}

export function getArtifactSnapshotDir(slug: string): string {
  return join(getArtifactsDir(), 'snapshots', slug);
}

export function getArtifactSnapshotPath(slug: string): string {
  return join(getArtifactSnapshotDir(slug), 'index.html');
}

export function generateArtifactSlug(): string {
  return randomBytes(6).toString('base64url').slice(0, 8);
}

export function computeArtifactPendingChanges(artifact: ArtifactMetadata, currentHash = artifact.currentHash): boolean {
  return artifact.lastPublishedHash !== null && artifact.lastPublishedHash !== undefined
    ? artifact.lastPublishedHash !== currentHash
    : true;
}

export function getArtifactLifecycleState(
  artifact: ArtifactMetadata,
  currentHash = artifact.currentHash,
): ArtifactLifecycleState {
  if (artifact.unsharedAt) return 'unshared';
  return computeArtifactPendingChanges(artifact, currentHash) ? 'pending_changes' : 'published';
}

export class ArtifactIndexRepository {
  private readonly db: SqliteDatabase;
  private readonly now: () => string;
  private readonly slugGenerator: () => string;
  private readonly maxSlugAttempts: number;

  constructor(options: ArtifactIndexOptions = {}) {
    const dbPath = options.dbPath ?? getArtifactIndexPath();
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = openDatabase(dbPath);
    this.now = options.now ?? (() => new Date().toISOString());
    this.slugGenerator = options.slugGenerator ?? generateArtifactSlug;
    this.maxSlugAttempts = options.maxSlugAttempts ?? 32;
    initializeArtifactIndexSchema(this.db);
  }

  close(): void {
    this.db.close();
  }

  createArtifact(input: CreateArtifactInput): ArtifactIndexEntry {
    const slug = input.slug ?? this.generateUniqueSlug();
    assertValidSlug(slug);
    const createdAt = input.createdAt ?? this.now();

    this.db.prepare(`
      INSERT INTO artifacts (
        artifact_id, slug, issue_id, workspace_id, agent_role, agent_harness,
        run_id, session_id, file_path, current_hash, last_published_hash,
        supersedes, title, description, created_at, published_at, unshared_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.artifactId,
      slug,
      input.issueId ?? null,
      input.workspaceId ?? null,
      input.agentRole ?? null,
      input.agentHarness ?? null,
      input.runId ?? null,
      input.sessionId ?? null,
      input.filePath,
      input.currentHash,
      input.lastPublishedHash ?? null,
      input.supersedes ?? null,
      input.title ?? null,
      input.description ?? null,
      createdAt,
      input.publishedAt ?? null,
      input.unsharedAt ?? null,
    );

    const entry = this.getBySlug(slug);
    if (!entry) throw new Error(`Artifact insert failed for slug ${slug}`);
    return entry;
  }

  getBySlug(slug: string): ArtifactIndexEntry | null {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE slug = ?').get(slug) as ArtifactRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  getByFilePath(filePath: string): ArtifactIndexEntry | null {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE file_path = ? ORDER BY created_at DESC LIMIT 1').get(filePath) as ArtifactRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  listByWorkspace(workspaceId: string): ArtifactIndexEntry[] {
    const rows = this.db.prepare('SELECT * FROM artifacts WHERE workspace_id = ? ORDER BY created_at DESC').all(workspaceId) as unknown as ArtifactRow[];
    return rows.map(rowToEntry);
  }

  listByIssue(issueId: string): ArtifactIndexEntry[] {
    const rows = this.db.prepare('SELECT * FROM artifacts WHERE issue_id = ? ORDER BY created_at DESC').all(issueId) as unknown as ArtifactRow[];
    return rows.map(rowToEntry);
  }

  listAll(): ArtifactIndexEntry[] {
    const rows = this.db.prepare('SELECT * FROM artifacts ORDER BY created_at DESC').all() as unknown as ArtifactRow[];
    return rows.map(rowToEntry);
  }

  updateCurrentHash(artifactId: string, currentHash: string): ArtifactIndexEntry | null {
    this.db.prepare('UPDATE artifacts SET current_hash = ? WHERE artifact_id = ?').run(currentHash, artifactId);
    return this.getByArtifactId(artifactId);
  }

  updatePublished(artifactId: string, currentHash: string, publishedAt = this.now()): ArtifactIndexEntry | null {
    this.db.prepare(`
      UPDATE artifacts
      SET current_hash = ?, last_published_hash = ?, published_at = ?, unshared_at = NULL
      WHERE artifact_id = ?
    `).run(currentHash, currentHash, publishedAt, artifactId);
    return this.getByArtifactId(artifactId);
  }

  unshare(artifactId: string, unsharedAt = this.now()): ArtifactIndexEntry | null {
    this.db.prepare('UPDATE artifacts SET unshared_at = ? WHERE artifact_id = ?').run(unsharedAt, artifactId);
    return this.getByArtifactId(artifactId);
  }

  getStatusByFilePath(filePath: string, currentHash?: string): ArtifactIndexEntry | null {
    const entry = this.getByFilePath(filePath);
    if (!entry) return null;
    if (!currentHash || currentHash === entry.artifact.currentHash) return entry;
    const artifact = { ...entry.artifact, currentHash };
    return {
      artifact,
      pendingChanges: computeArtifactPendingChanges(entry.artifact, currentHash),
      status: getArtifactLifecycleState(entry.artifact, currentHash),
    };
  }

  private getByArtifactId(artifactId: string): ArtifactIndexEntry | null {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE artifact_id = ?').get(artifactId) as ArtifactRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  private generateUniqueSlug(): string {
    for (let attempt = 0; attempt < this.maxSlugAttempts; attempt += 1) {
      const slug = this.slugGenerator();
      assertValidSlug(slug);
      if (!this.getBySlug(slug)) return slug;
    }
    throw new Error(`Unable to generate unique artifact slug after ${this.maxSlugAttempts} attempts`);
  }
}

export function createArtifactIndexRepository(options: ArtifactIndexOptions = {}): ArtifactIndexRepository {
  return new ArtifactIndexRepository(options);
}

function initializeArtifactIndexSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      artifact_id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      issue_id TEXT,
      workspace_id TEXT,
      agent_role TEXT,
      agent_harness TEXT,
      run_id TEXT,
      session_id TEXT,
      file_path TEXT NOT NULL,
      current_hash TEXT NOT NULL,
      last_published_hash TEXT,
      supersedes TEXT,
      title TEXT,
      description TEXT,
      created_at TEXT NOT NULL,
      published_at TEXT,
      unshared_at TEXT
    );

    CREATE INDEX IF NOT EXISTS artifacts_workspace ON artifacts(workspace_id);
    CREATE INDEX IF NOT EXISTS artifacts_issue ON artifacts(issue_id);
    CREATE INDEX IF NOT EXISTS artifacts_slug ON artifacts(slug);
  `);
}

function rowToEntry(row: ArtifactRow): ArtifactIndexEntry {
  const artifact: ArtifactMetadata = {
    artifactId: row.artifact_id,
    slug: row.slug,
    issueId: row.issue_id,
    workspaceId: row.workspace_id,
    agentRole: row.agent_role,
    agentHarness: row.agent_harness,
    runId: row.run_id,
    sessionId: row.session_id,
    filePath: row.file_path,
    currentHash: row.current_hash,
    lastPublishedHash: row.last_published_hash,
    supersedes: row.supersedes,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    unsharedAt: row.unshared_at,
  };
  return {
    artifact,
    pendingChanges: computeArtifactPendingChanges(artifact),
    status: getArtifactLifecycleState(artifact),
  };
}

function assertValidSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`Artifact slug must be 8 URL-safe characters: ${slug}`);
  }
}

