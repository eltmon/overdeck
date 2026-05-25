import Database from 'better-sqlite3';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeFeatureRegistryStorage,
  initializeFeatureRegistryStorage,
  listFeatureRegistryEntries,
  resolveFeatureRegistryDbPath,
  showFeatureRegistryFeature,
  tagFeatureRegistryIssue,
  untagFeatureRegistryIssue,
  updateFeatureRegistryOwnership,
} from '../../../src/lib/registry/feature-registry-storage.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-feature-registry-'));
  process.env.PANOPTICON_HOME = tempDir;
});

afterEach(async () => {
  await closeFeatureRegistryStorage();
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('feature registry storage', () => {
  it('creates the registry database with feature lookup columns and indexes', async () => {
    await initializeFeatureRegistryStorage();

    const dbFile = await stat(resolveFeatureRegistryDbPath());
    expect(dbFile.isFile()).toBe(true);

    const db = new Database(resolveFeatureRegistryDbPath(), { readonly: true });
    try {
      const columns = db.prepare('PRAGMA table_info(features)').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual([
        'feature_id',
        'feature_name',
        'description',
        'owning_workspace_id',
        'owning_issue_id',
        'owning_agent_id',
        'status',
        'created_at',
        'updated_at',
        'tags',
      ]);

      const indexes = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND name IN (
            'idx_features_feature_name',
            'idx_features_status',
            'idx_features_owning_issue_id',
            'idx_features_owning_workspace_id',
            'idx_features_owning_agent_id'
          )
        ORDER BY name
      `).all() as Array<{ name: string }>;
      expect(indexes.map((row) => row.name)).toEqual([
        'idx_features_feature_name',
        'idx_features_owning_agent_id',
        'idx_features_owning_issue_id',
        'idx_features_owning_workspace_id',
        'idx_features_status',
      ]);
    } finally {
      db.close();
    }
  });

  it('tags an issue and lists the feature entry', async () => {
    const entry = await tagFeatureRegistryIssue({
      issueId: 'pan-1204',
      featureName: 'knowledge-registry',
      description: 'Home tab ownership registry',
      status: 'active',
      tags: ['home', 'registry'],
      now: '2026-05-25T01:10:00.000Z',
    });

    expect(entry).toMatchObject({
      featureName: 'knowledge-registry',
      description: 'Home tab ownership registry',
      owningIssueId: 'PAN-1204',
      status: 'active',
      tags: ['home', 'registry'],
      createdAt: '2026-05-25T01:10:00.000Z',
      updatedAt: '2026-05-25T01:10:00.000Z',
    });

    const entries = await listFeatureRegistryEntries({ issueId: 'PAN-1204' });
    expect(entries).toHaveLength(1);
    expect(entries[0].featureId).toBe(entry.featureId);
  });

  it('shows a feature by case-insensitive feature name', async () => {
    await tagFeatureRegistryIssue({ issueId: 'PAN-1204', featureName: 'Session-Context', tags: ['briefing'] });

    const entry = await showFeatureRegistryFeature('session-context');

    expect(entry).toMatchObject({
      featureName: 'Session-Context',
      owningIssueId: 'PAN-1204',
      tags: ['briefing'],
    });
  });

  it('updates ownership and status by workspace or issue state', async () => {
    await tagFeatureRegistryIssue({ issueId: 'PAN-1204', featureName: 'briefing-refresh' });

    const updatedByIssue = await updateFeatureRegistryOwnership({
      issueId: 'PAN-1204',
      workspaceId: 'feature-pan-1204-slot-2',
      agentId: 'agent-pan-1204-2',
      status: 'merged',
      now: '2026-05-25T02:00:00.000Z',
    });

    expect(updatedByIssue).toHaveLength(1);
    expect(updatedByIssue[0]).toMatchObject({
      owningWorkspaceId: 'feature-pan-1204-slot-2',
      owningIssueId: 'PAN-1204',
      owningAgentId: 'agent-pan-1204-2',
      status: 'merged',
      updatedAt: '2026-05-25T02:00:00.000Z',
    });

    const updatedByWorkspace = await updateFeatureRegistryOwnership({
      workspaceId: 'feature-pan-1204-slot-2',
      agentId: null,
      status: 'archived',
      now: '2026-05-25T03:00:00.000Z',
    });

    expect(updatedByWorkspace[0]).toMatchObject({
      owningAgentId: null,
      status: 'archived',
      updatedAt: '2026-05-25T03:00:00.000Z',
    });
  });

  it('untags an issue feature and removes the registry row', async () => {
    await tagFeatureRegistryIssue({ issueId: 'PAN-1204', featureName: 'compliance-audit' });

    await expect(untagFeatureRegistryIssue({ issueId: 'PAN-1204', featureName: 'compliance-audit' })).resolves.toBe(true);
    await expect(showFeatureRegistryFeature('compliance-audit')).resolves.toBeNull();
  });
});
