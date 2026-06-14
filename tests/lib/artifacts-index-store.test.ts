import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, type SqliteDatabase } from '../../src/lib/database/driver.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArtifactIndexRepository,
  computeArtifactPendingChanges,
  generateArtifactSlug,
  getArtifactIndexPath,
  getArtifactSnapshotPath,
} from '../../src/lib/artifacts/index-store.js';

describe('artifact index store', () => {
  let originalHome: string | undefined;
  let home: string;

  beforeEach(() => {
    originalHome = process.env.PANOPTICON_HOME;
    home = mkdtempSync(join(tmpdir(), 'pan-artifact-index-'));
    process.env.PANOPTICON_HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
    else process.env.PANOPTICON_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('creates the artifact table and lookup indexes under PANOPTICON_HOME', () => {
    const repo = new ArtifactIndexRepository();
    repo.close();

    expect(getArtifactIndexPath()).toBe(join(home, 'artifacts', 'index.sqlite'));
    expect(getArtifactSnapshotPath('abc12345')).toBe(join(home, 'artifacts', 'snapshots', 'abc12345', 'index.html'));

    const db = openDatabase(getArtifactIndexPath());
    try {
      const objects = db.prepare(`
        SELECT name, type
        FROM sqlite_master
        WHERE name IN ('artifacts', 'artifacts_workspace', 'artifacts_issue', 'artifacts_slug')
        ORDER BY name
      `).all() as Array<{ name: string; type: string }>;

      expect(objects).toEqual([
        { name: 'artifacts', type: 'table' },
        { name: 'artifacts_issue', type: 'index' },
        { name: 'artifacts_slug', type: 'index' },
        { name: 'artifacts_workspace', type: 'index' },
      ]);
    } finally {
      db.close();
    }
  });

  it('creates, reads, lists, publishes, unshares, and computes pending changes', () => {
    const repo = new ArtifactIndexRepository({
      now: () => '2026-05-25T00:00:00.000Z',
      slugGenerator: () => 'slug0001',
    });

    const created = repo.createArtifact({
      artifactId: '01JZ0000000000000000000000',
      filePath: '/tmp/comparison.html',
      currentHash: 'sha256:abc123',
      issueId: 'PAN-1205',
      workspaceId: 'feature-pan-1205-slot-2',
      agentRole: 'work',
      agentHarness: 'claude-code',
      runId: 'RUN-42',
      sessionId: 'session-123',
      lastPublishedHash: 'sha256:abc123',
      title: 'Comparison',
      description: 'Artifact comparison',
      publishedAt: '2026-05-25T00:00:00.000Z',
    });

    expect(created.artifact.slug).toBe('slug0001');
    expect(created.pendingChanges).toBe(false);
    expect(created.status).toBe('published');
    expect(repo.getBySlug('slug0001')?.artifact.filePath).toBe('/tmp/comparison.html');
    expect(repo.getByFilePath('/tmp/comparison.html')?.artifact.issueId).toBe('PAN-1205');
    expect(repo.listByWorkspace('feature-pan-1205-slot-2')).toHaveLength(1);
    expect(repo.listByIssue('PAN-1205')).toHaveLength(1);

    const pending = repo.getStatusByFilePath('/tmp/comparison.html', 'sha256:def456');
    expect(pending?.pendingChanges).toBe(true);
    expect(pending?.status).toBe('pending_changes');
    expect(pending?.artifact.currentHash).toBe('sha256:def456');
    expect(computeArtifactPendingChanges(created.artifact, 'sha256:def456')).toBe(true);

    const published = repo.updatePublished(created.artifact.artifactId, 'sha256:def456', '2026-05-25T00:01:00.000Z');
    expect(published?.artifact.lastPublishedHash).toBe('sha256:def456');
    expect(published?.artifact.publishedAt).toBe('2026-05-25T00:01:00.000Z');
    expect(published?.pendingChanges).toBe(false);

    const unshared = repo.unshare(created.artifact.artifactId, '2026-05-25T00:02:00.000Z');
    expect(unshared?.artifact.unsharedAt).toBe('2026-05-25T00:02:00.000Z');
    expect(unshared?.status).toBe('unshared');

    repo.close();
  });

  it('generates eight-character URL-safe slugs and retries collisions', () => {
    expect(generateArtifactSlug()).toMatch(/^[A-Za-z0-9_-]{8}$/);

    const slugs = ['dupe0001', 'dupe0001', 'uniq0002'];
    const repo = new ArtifactIndexRepository({ slugGenerator: () => slugs.shift() ?? 'unused00' });

    repo.createArtifact({
      artifactId: '01JZ0000000000000000000001',
      filePath: '/tmp/first.html',
      currentHash: 'sha256:first',
      slug: 'dupe0001',
    });
    const second = repo.createArtifact({
      artifactId: '01JZ0000000000000000000002',
      filePath: '/tmp/second.html',
      currentHash: 'sha256:second',
    });

    expect(second.artifact.slug).toBe('uniq0002');
    expect(repo.getBySlug('dupe0001')?.artifact.filePath).toBe('/tmp/first.html');
    expect(repo.getBySlug('uniq0002')?.artifact.filePath).toBe('/tmp/second.html');

    repo.close();
  });
});
