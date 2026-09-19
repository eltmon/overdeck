import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerCloseCommand } from '../../../../src/cli/commands/close.js';
import {
  checkShipRow,
  evaluateDodGate,
} from '../../../../src/lib/lifecycle/dod-gate.js';
import { DOD_ROWS, type DodRowId, type DodRowResult } from '../../../../src/lib/lifecycle/dod.js';

const ctx = { issueId: 'PAN-3358', projectPath: '/repo/overdeck' };

/**
 * PAN-3917: the ship row reads the release tag reachable from origin/main and
 * the project's declared version_sync expect paths — no batch ship record.
 */
function shipDeps(options: {
  versionSync?: { expect: Array<{ path: string; pattern: string }> };
  version?: string | null;
  contents?: Record<string, string | null>;
}) {
  return {
    readProject: () => ({
      name: 'Overdeck',
      path: ctx.projectPath,
      ...(options.versionSync ? { version_sync: options.versionSync } : {}),
    }),
    readShippedVersion: async () => options.version ?? null,
    readExpectPath: async (_ctx: unknown, path: string) => options.contents?.[path] ?? null,
  };
}

const EXPECT_ONE = { expect: [{ path: 'package.json', pattern: '"version": "{version}"' }] };

describe('checkShipRow', () => {
  it('skips when the project declares no version_sync', async () => {
    expect(await checkShipRow(ctx, shipDeps({}))).toMatchObject({
      status: 'skip',
      observed: 'project declares no version_sync; ship step not applicable',
    });
  });

  it('skips when version_sync declares no expect paths', async () => {
    expect(await checkShipRow(ctx, shipDeps({ versionSync: { expect: [] } }))).toMatchObject({
      status: 'skip',
      observed: 'version_sync declares no expect paths; nothing to verify',
    });
  });

  it('misses when no release tag is reachable from origin/main', async () => {
    expect(await checkShipRow(ctx, shipDeps({ versionSync: EXPECT_ONE, version: null }))).toMatchObject({
      status: 'miss',
      observed: expect.stringContaining('pan release stable'),
    });
  });

  it('passes when every declared path carries the shipped version', async () => {
    const row = await checkShipRow(ctx, shipDeps({
      versionSync: EXPECT_ONE,
      version: '0.51.0',
      contents: { 'package.json': '{ "version": "0.51.0" }' },
    }));

    expect(row).toMatchObject({
      status: 'pass',
      observed: 'version 0.51.0 present in all 1 declared version_sync path(s) on origin/main',
    });
  });

  it('names the paths that did not receive the version', async () => {
    const row = await checkShipRow(ctx, shipDeps({
      versionSync: {
        expect: [
          { path: 'package.json', pattern: '"version": "{version}"' },
          { path: 'ios/Info.plist', pattern: '<string>{majorMinor}</string>' },
        ],
      },
      version: '0.51.0',
      contents: { 'package.json': '{ "version": "0.51.0" }', 'ios/Info.plist': '<string>0.50</string>' },
    }));

    expect(row).toMatchObject({ status: 'miss' });
    expect(row.observed).toContain('1 of 2 declared path(s)');
    expect(row.observed).toContain('ios/Info.plist');
  });

  it('reports an unreadable path rather than silently passing it', async () => {
    const row = await checkShipRow(ctx, shipDeps({
      versionSync: EXPECT_ONE,
      version: '0.51.0',
      contents: {},
    }));

    expect(row).toMatchObject({ status: 'miss' });
    expect(row.observed).toContain('package.json (unreadable at origin/main)');
  });
});

function row(id: DodRowId, status: DodRowResult['status'] = 'pass'): DodRowResult {
  return { ...DOD_ROWS.find(candidate => candidate.id === id)!, status, observed: id };
}

describe('ship row gate integration', () => {
  const deps = {
    review: async () => row('review'),
    tests: async () => row('tests'),
    verification: async () => row('verification'),
    merged: async () => ({ ...row('merged'), mergeCommit: 'abc123' }),
    postMerge: async () => row('post-merge'),
    mainVerify: async () => row('main-verify'),
    ship: async () => row('ship', 'miss'),
    deploy: async () => row('deploy'),
    trackerClosed: async () => false,
    now: () => '2026-07-31T02:00:00.000Z',
  };

  it('places ship between main-verify and deploy and allows an operator override', async () => {
    const blocked = await evaluateDodGate(ctx, {}, deps);
    expect(blocked.rows.map(result => result.id)).toEqual(DOD_ROWS.slice(0, 8).map(result => result.id));
    expect(blocked).toMatchObject({ passed: false, misses: ['ship'] });

    const accepted = await evaluateDodGate(ctx, {
      acceptedRows: ['ship'],
      acceptedBy: 'operator',
    }, deps);
    expect(accepted).toMatchObject({ passed: true, accepted: ['ship'] });
    expect(accepted.rows.find(result => result.id === 'ship')?.acceptedBy?.flag).toBe('--accept-ship');
  });

  it('rejects a ship override from the autonomous flywheel', async () => {
    await expect(evaluateDodGate(ctx, {
      acceptedRows: ['ship'],
      acceptedBy: 'flywheel-orchestrator',
    }, deps)).rejects.toThrow('flywheel orchestrator cannot accept');
  });

  it('registers --accept-ship on pan close', () => {
    const program = new Command();
    registerCloseCommand(program);
    const close = program.commands.find(command => command.name() === 'close');
    expect(close?.options.map(option => option.long)).toContain('--accept-ship');
  });
});
