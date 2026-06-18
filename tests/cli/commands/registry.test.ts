import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  formatRegistryEntry,
  formatRegistryList,
  runRegistryList,
  runRegistryShow,
  runRegistryTag,
} from '../../../src/cli/commands/registry.js';
import { closeFeatureRegistryStorage } from '../../../src/lib/registry/feature-registry-storage.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.OVERDECK_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-registry-cli-'));
  process.env.OVERDECK_HOME = tempDir;
});

afterEach(async () => {
  await closeFeatureRegistryStorage();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('registry command helpers', () => {
  it('tags an issue and shows the feature record without the global registry database', async () => {
    const entry = await runRegistryTag('pan-1204', 'knowledge-registry', {
      description: 'Feature ownership records',
      workspace: 'feature-pan-1204-slot-2',
      agent: 'agent-pan-1204-slot-2',
      status: 'active',
      tag: ['home', 'registry'],
    });

    expect(entry).toMatchObject({
      featureName: 'knowledge-registry',
      description: 'Feature ownership records',
      owningIssueId: 'PAN-1204',
      owningWorkspaceId: 'feature-pan-1204-slot-2',
      owningAgentId: 'agent-pan-1204-slot-2',
      status: 'active',
      tags: ['home', 'registry'],
    });
    await expect(runRegistryShow('Knowledge-Registry')).resolves.toMatchObject({ featureId: entry.featureId });
  });

  it('lists registry rows with issue, workspace, status, and tag filters', async () => {
    await runRegistryTag('PAN-1204', 'knowledge-registry', {
      workspace: 'feature-pan-1204-slot-2',
      agent: 'agent-pan-1204-slot-2',
      status: 'active',
      tag: ['home', 'registry'],
    });
    await runRegistryTag('PAN-999', 'other-feature', { status: 'deferred', tag: ['other'] });

    const entries = await runRegistryList({
      issue: 'PAN-1204',
      workspace: 'feature-pan-1204-slot-2',
      status: 'active',
      tag: ['registry'],
      limit: 10,
    });

    expect(entries.map((entry) => entry.featureName)).toEqual(['knowledge-registry']);
    const output = formatRegistryList(entries).join('\n');
    expect(output).toContain('Feature');
    expect(output).toContain('knowledge-registry');
    expect(output).toContain('PAN-1204');
    expect(output).toContain('feature-pan-1204-slot-2');
    expect(output).toContain('agent-pan-1204-slot-2');
    expect(output).toContain('active');
    expect(output).toContain('home,registry');
  });

  it('formats missing and detailed show output predictably', async () => {
    await expect(runRegistryShow('missing-feature')).resolves.toBeNull();

    const entry = await runRegistryTag('PAN-1204', 'session-context', {
      description: 'Live briefing file',
      tag: ['briefing'],
    });
    const output = formatRegistryEntry(entry).join('\n');

    expect(formatRegistryList([]).join('\n')).toContain('No feature registry entries found.');
    expect(output).toContain('Feature: session-context');
    expect(output).toContain('Issue: PAN-1204');
    expect(output).toContain('Tags: briefing');
    expect(output).toContain('Description: Live briefing file');
  });
});
