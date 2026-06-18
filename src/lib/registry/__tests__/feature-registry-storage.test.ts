import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeFeatureRegistryStorage,
  listFeatureRegistryEntries,
  showFeatureRegistryFeature,
  tagFeatureRegistryIssue,
  untagFeatureRegistryIssue,
  updateFeatureRegistryOwnership,
} from '../feature-registry-storage.js';

let testHome: string;

beforeEach(() => {
  testHome = join(tmpdir(), `pan-1579-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env.OVERDECK_HOME = testHome;
});

afterEach(async () => {
  await closeFeatureRegistryStorage();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('feature registry storage', () => {
  it('tags, lists, shows, updates, and untags features through the SQLite adapter', async () => {
    const tagged = await tagFeatureRegistryIssue({
      featureName: 'SQLite Driver',
      issueId: 'pan-1579',
      workspaceId: 'workspace-1',
      agentId: 'agent-1',
      tags: ['database', 'sqlite'],
      now: '2026-06-04T08:00:00.000Z',
    });

    expect(tagged.owningIssueId).toBe('PAN-1579');
    expect(tagged.tags).toEqual(['database', 'sqlite']);
    expect(await showFeatureRegistryFeature('sqlite driver')).toMatchObject({ featureName: 'SQLite Driver' });
    expect(await listFeatureRegistryEntries({ tags: ['sqlite'] })).toHaveLength(1);

    const updated = await updateFeatureRegistryOwnership({
      featureName: 'SQLite Driver',
      issueId: 'PAN-1579',
      workspaceId: 'workspace-2',
      status: 'merged',
      tags: ['database'],
      now: '2026-06-04T09:00:00.000Z',
    });
    expect(updated[0]).toMatchObject({ owningWorkspaceId: 'workspace-2', status: 'merged', tags: ['database'] });

    expect(await untagFeatureRegistryIssue({ featureName: 'SQLite Driver', issueId: 'PAN-1579' })).toBe(true);
    expect(await showFeatureRegistryFeature('SQLite Driver')).toBeNull();
  });
});
