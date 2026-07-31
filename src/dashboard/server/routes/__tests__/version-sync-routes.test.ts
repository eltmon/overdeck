import { describe, expect, it, vi } from 'vitest';
import {
  getProjectVersionSyncPayload,
  putProjectVersionSyncPayload,
} from '../projects.js';
import type { ProjectConfig, VersionSyncConfig } from '../../../../lib/projects.js';
import type { PanIssueShipRecord } from '../../../../lib/pan-dir/record.js';
import type { UatGeneration } from '../../../../lib/overdeck/merge-sync.js';
import { aggregateGenerationShipStatus } from '../../../../lib/cloister/ship-status.js';

const CONFIG = {
  set: [{ path: 'package.json', json_field: 'version' }],
  replace: [{
    path: 'app/build.gradle',
    pattern: 'versionName "(?<version>\\d+\\.\\d+)"',
    value: '{majorMinor}',
  }],
  command: 'sync-version',
  command_image: 'version-sync:latest',
  expect: [{ path: 'package.json', pattern: '"version": "{version}"' }],
  push: ['.'],
} satisfies VersionSyncConfig;

function project(versionSync: VersionSyncConfig | null = CONFIG): ProjectConfig {
  return {
    name: 'Overdeck',
    path: '/repo/overdeck',
    ...(versionSync ? { version_sync: versionSync } : {}),
  };
}

function promotedGeneration(): UatGeneration {
  return {
    name: 'uat/pan-ember-0731',
    worktreePath: '/repo/overdeck/workspaces/uat-pan-ember-0731',
    projectRoot: '/repo/overdeck',
    baseSha: 'main-sha',
    status: 'promoted',
    members: [
      { issueId: 'PAN-1', title: 'One', branch: 'feature/pan-1', headSha: 'one', mergeOrder: 1 },
      { issueId: 'PAN-2', title: 'Two', branch: 'feature/pan-2', headSha: 'two', mergeOrder: 2 },
    ],
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  };
}

function deps(options: {
  config?: ProjectConfig | null;
  generation?: UatGeneration;
  outcomes?: Record<string, PanIssueShipRecord | null>;
} = {}) {
  return {
    getProject: vi.fn(() => options.config === undefined ? project() : options.config),
    listProjectKeys: vi.fn(() => ['overdeck', 'myn']),
    listPromotedGenerations: vi.fn(() => options.generation ? [options.generation] : []),
    readOutcome: vi.fn(async (_project: ProjectConfig, generation: UatGeneration) =>
      aggregateGenerationShipStatus(
        generation,
        new Map(generation.members.map(member => [member.issueId, options.outcomes?.[member.issueId] ?? null])),
      )),
    writeVersionSync: vi.fn(async () => {}),
  };
}

describe('GET /api/projects/:projectKey/version-sync payload', () => {
  it('returns null config and null outcome for a project that skips ship', async () => {
    const result = await getProjectVersionSyncPayload('overdeck', deps({ config: project(null) }));
    expect(result).toEqual({ status: 200, body: { config: null, lastOutcome: null } });
  });

  it('returns configured version_sync and a conservative all-member outcome', async () => {
    const older: PanIssueShipRecord = {
      status: 'partial',
      version: '48.7.0',
      batch: 'uat/pan-ember-0731',
      paths: [],
      error: 'operator-safe internal detail',
      reason: 'internal settlement reason',
      at: '2026-07-31T01:00:00Z',
    };
    const newest: PanIssueShipRecord = {
      status: 'passed', version: '48.8.0', batch: 'uat/pan-ember-0731', paths: [], at: '2026-07-31T02:00:00Z',
    };
    const result = await getProjectVersionSyncPayload('overdeck', deps({
      generation: promotedGeneration(),
      outcomes: { 'PAN-1': older, 'PAN-2': newest },
    }));
    expect(result).toEqual({
      status: 200,
      body: {
        config: CONFIG,
        lastOutcome: {
          status: 'partial',
          version: '48.7.0',
          batch: 'uat/pan-ember-0731',
          paths: [],
          at: '2026-07-31T01:00:00Z',
        },
      },
    });
  });
});

describe('PUT /api/projects/:projectKey/version-sync payload', () => {
  it('persists a valid block through the write door and clears with null', async () => {
    const d = deps();
    expect(await putProjectVersionSyncPayload('overdeck', { config: CONFIG }, d)).toEqual({
      status: 200,
      body: { config: CONFIG },
    });
    expect(d.writeVersionSync).toHaveBeenCalledWith('overdeck', CONFIG);

    expect(await putProjectVersionSyncPayload('overdeck', { config: null }, d)).toEqual({
      status: 200,
      body: { config: null },
    });
    expect(d.writeVersionSync).toHaveBeenLastCalledWith('overdeck', null);
  });

  it.each([{}, { expect: [], push: [] }])(
    'returns 400 and writes nothing for a no-op active config %#',
    async (config) => {
      const d = deps();
      const result = await putProjectVersionSyncPayload('overdeck', { config }, d);
      expect(result).toEqual({
        status: 400,
        body: {
          errors: [
            'version_sync.expect must contain at least one entry',
            'version_sync.push must contain at least one repository',
          ],
        },
      });
      expect(d.writeVersionSync).not.toHaveBeenCalled();
    },
  );

  it('returns 400 with validation errors and writes nothing for a bad pattern', async () => {
    const d = deps();
    const result = await putProjectVersionSyncPayload('overdeck', {
      config: { expect: [{ path: 'package.json', pattern: '[' }], push: ['.'] },
    }, d);
    expect(result).toEqual({
      status: 400,
      body: { errors: ['version_sync.expect[0].pattern must be a valid regular expression'] },
    });
    expect(d.writeVersionSync).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown project and names the known keys', async () => {
    const d = deps({ config: null });
    expect(await putProjectVersionSyncPayload('missing', { config: CONFIG }, d)).toEqual({
      status: 404,
      body: { error: 'Unknown project key: missing. Known project keys: overdeck, myn' },
    });
  });
});
