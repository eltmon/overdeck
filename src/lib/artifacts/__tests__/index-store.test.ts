import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArtifactIndexRepository } from '../index-store.js';

describe('ArtifactIndexRepository', () => {
  it('creates, lists, publishes, and unshares artifacts through the SQLite adapter', () => {
    const dbPath = join(tmpdir(), `pan-1579-artifacts-${Date.now()}-${Math.random().toString(36).slice(2)}`, 'index.sqlite');
    const repo = createArtifactIndexRepository({
      dbPath,
      now: () => '2026-06-04T08:00:00.000Z',
      slugGenerator: () => 'abcd1234',
    });

    try {
      const created = repo.createArtifact({
        artifactId: 'artifact-1',
        filePath: '/tmp/artifact.html',
        currentHash: 'hash-1',
        issueId: 'PAN-1579',
        workspaceId: 'workspace-1',
        title: 'Artifact',
      });

      expect(created.artifact.slug).toBe('abcd1234');
      expect(created.status).toBe('pending_changes');
      expect(repo.getBySlug('abcd1234')?.artifact.artifactId).toBe('artifact-1');
      expect(repo.listByIssue('PAN-1579')).toHaveLength(1);
      expect(repo.listByWorkspace('workspace-1')).toHaveLength(1);

      expect(repo.updatePublished('artifact-1', 'hash-1')?.status).toBe('published');
      expect(repo.unshare('artifact-1')?.status).toBe('unshared');
    } finally {
      repo.close();
      rmSync(dbPath, { force: true });
    }
  });
});
