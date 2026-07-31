import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerCloseCommand } from '../../../../src/cli/commands/close.js';
import {
  checkShipRow,
  evaluateDodGate,
} from '../../../../src/lib/lifecycle/dod-gate.js';
import { DOD_ROWS, type DodRowId, type DodRowResult } from '../../../../src/lib/lifecycle/dod.js';
import type { PanIssuePipelineRecord } from '../../../../src/lib/pan-dir/record.js';

const ctx = { issueId: 'PAN-3358', projectPath: '/repo/overdeck' };

function pipeline(ship?: PanIssuePipelineRecord['ship']): PanIssuePipelineRecord {
  return {
    issueId: ctx.issueId,
    reviewStatus: 'passed',
    testStatus: 'passed',
    readyForMerge: true,
    ship,
    updatedAt: '2026-07-31T00:00:00.000Z',
  };
}

function shipDeps(
  versionSyncConfigured: boolean,
  ship?: PanIssuePipelineRecord['ship'],
  promotedBatch?: string,
) {
  return {
    readProject: () => ({
      name: 'Overdeck',
      path: ctx.projectPath,
      ...(versionSyncConfigured ? { version_sync: {} } : {}),
    }),
    readPipeline: async () => pipeline(ship),
    findPromotedBatch: () => promotedBatch ? { name: promotedBatch } : null,
  };
}

describe('checkShipRow', () => {
  it('skips when the project declares no version_sync', async () => {
    expect(await checkShipRow(ctx, shipDeps(false))).toMatchObject({
      status: 'skip',
      observed: 'project declares no version_sync; ship step not applicable',
    });
  });

  it('skips when the merge has no batch ship record', async () => {
    expect(await checkShipRow(ctx, shipDeps(true))).toMatchObject({
      status: 'skip',
      observed: 'merged outside a batch; ship is batch-scoped',
    });
  });

  it('misses when promoted batch membership exists but durable settlement is missing', async () => {
    expect(await checkShipRow(ctx, shipDeps(true, undefined, 'uat/pan-ember-0731'))).toMatchObject({
      status: 'miss',
      observed: 'batch uat/pan-ember-0731 includes this issue but no durable ship settlement was recorded',
    });
  });

  it('passes a recorded passed verdict with version, batch, and path count', async () => {
    expect(await checkShipRow(ctx, shipDeps(true, {
      status: 'passed',
      version: '48.8.0',
      batch: 'uat/pan-ember-0731',
      paths: [
        { path: 'package.json', ok: true, detail: 'reports 48.8.0' },
        { path: 'apps/desktop/package.json', ok: true, detail: 'reports 48.8.0' },
      ],
      at: '2026-07-31T01:00:00.000Z',
    }))).toMatchObject({
      status: 'pass',
      observed: 'version 48.8.0 shipped for batch uat/pan-ember-0731; 2 path(s) verified',
    });
  });

  it('misses pending with the deferred Ship version action', async () => {
    expect(await checkShipRow(ctx, shipDeps(true, {
      status: 'pending',
      batch: 'uat/pan-ember-0731',
      reason: 'no version supplied at promote time',
      at: '2026-07-31T01:00:00.000Z',
    }))).toMatchObject({
      status: 'miss',
      observed: expect.stringContaining('use the Ship version action on the batch card for uat/pan-ember-0731'),
    });
  });

  it('misses partial and failed verdicts with their actionable evidence', async () => {
    const partial = await checkShipRow(ctx, shipDeps(true, {
      status: 'partial',
      version: '48.8.0',
      batch: 'uat/pan-ember-0731',
      paths: [
        { path: 'package.json', ok: true, detail: 'reports 48.8.0' },
        { path: 'apps/desktop/package.json', ok: false, detail: 'pattern missed' },
        { path: 'packages/contracts/package.json', ok: false, detail: 'pattern missed' },
      ],
      at: '2026-07-31T01:00:00.000Z',
    }));
    expect(partial).toMatchObject({ status: 'miss' });
    expect(partial.observed).toContain('apps/desktop/package.json, packages/contracts/package.json');

    const failed = await checkShipRow(ctx, shipDeps(true, {
      status: 'failed',
      version: '48.8.0',
      batch: 'uat/pan-ember-0731',
      error: 'push rejected',
      at: '2026-07-31T01:00:00.000Z',
    }));
    expect(failed).toMatchObject({ status: 'miss', observed: expect.stringContaining('push rejected') });
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
