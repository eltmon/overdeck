import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DomainEvent, INITIAL_READ_MODEL_STATE, applyEvent, type RestartGateSnapshot } from '@overdeck/contracts';

import type { RestartLockHolder } from '../../../../lib/restart-lock.js';
import type { RestartStatus } from '../../../../lib/restart-status.js';
import {
  FAILED_VISIBLE_MS,
  createDeployProgressObserver,
  deriveDeployProjection,
  readLogTail,
  type DeployObservation,
  type DeployProjection,
} from '../deploy-progress.js';

const T0 = Date.parse('2026-09-24T12:00:00.000Z');
const PID = 4242;
const holder: RestartLockHolder = { pid: PID, ts: T0, caller: 'pan reload' };
const idleGate: RestartGateSnapshot = { status: 'idle', pending: [] };

function observation(overrides: Partial<DeployObservation> = {}): DeployObservation {
  return {
    lockHolder: holder,
    gate: idleGate,
    lastStatus: null,
    projectKey: 'overdeck',
    firstSeenAt: new Date(T0).toISOString(),
    nowMs: T0 + 30_000,
    ...overrides,
  };
}

function status(overrides: Partial<RestartStatus>): RestartStatus {
  return {
    ts: new Date(T0).toISOString(), trigger: 'pan reload', success: false,
    durationMs: 1000, attempts: 1, pid: PID, ...overrides,
  };
}

describe('deriveDeployProjection', () => {
  it('reports a live reload as building on the owning project', () => {
    expect(deriveDeployProjection(observation({ logPath: '/x/reload.log', logTail: ['Building…'] }))).toEqual({
      overdeck: {
        projectKey: 'overdeck', trigger: 'pan reload', phase: 'building', pid: PID,
        startedAt: new Date(T0).toISOString(), logPath: '/x/reload.log', logTail: ['Building…'],
      },
    });
  });

  it('reports waiting for the operator when the reload has a pending gate request', () => {
    const gate: RestartGateSnapshot = {
      status: 'pending',
      pending: [{ requesterId: `reload:${PID}`, kind: 'reload', reason: 'r', requestedAt: new Date(T0).toISOString() }],
    };
    expect(deriveDeployProjection(observation({ gate })).overdeck?.phase).toBe('awaiting-approval');
  });

  it('ignores gate requests from other processes', () => {
    const gate: RestartGateSnapshot = {
      status: 'pending',
      pending: [{ requesterId: `restart:${PID + 1}`, kind: 'restart', reason: 'r', requestedAt: new Date(T0).toISOString() }],
    };
    expect(deriveDeployProjection(observation({ gate })).overdeck?.phase).toBe('building');
  });

  it('reports restarting once the reload recorded its stopping marker', () => {
    const lastStatus = status({ phase: 'stopping' });
    expect(deriveDeployProjection(observation({ lastStatus })).overdeck?.phase).toBe('restarting');
  });

  it('surfaces a recent failed reload with its error after the lock is gone', () => {
    const lastStatus = status({ error: 'build failed — old dashboard left running', phase: 'failed' });
    expect(deriveDeployProjection(observation({ lockHolder: null, lastStatus }))).toEqual({
      overdeck: {
        projectKey: 'overdeck', trigger: 'pan reload', phase: 'failed',
        startedAt: new Date(T0).toISOString(), error: 'build failed — old dashboard left running',
      },
    });
  });

  it('clears when there is no live reload and no recent failure', () => {
    expect(deriveDeployProjection(observation({ lockHolder: null }))).toEqual({});
    expect(deriveDeployProjection(observation({ lockHolder: null, lastStatus: status({ success: true, phase: 'healthy' }) }))).toEqual({});
    expect(deriveDeployProjection(observation({ lockHolder: null, lastStatus: status({ phase: 'stopping' }) }))).toEqual({});
    const stale = status({ phase: 'failed' });
    expect(deriveDeployProjection(observation({ lockHolder: null, lastStatus: stale, nowMs: T0 + FAILED_VISIBLE_MS + 1 }))).toEqual({});
  });

  it('ignores a restart lock held by something other than pan reload', () => {
    expect(deriveDeployProjection(observation({ lockHolder: { ...holder, caller: 'pan restart' } }))).toEqual({});
  });

  it('publishes nothing when the owning project cannot be resolved', () => {
    expect(deriveDeployProjection(observation({ projectKey: null }))).toEqual({});
  });
});

describe('createDeployProgressObserver', () => {
  it('emits once per change, keeps the first-seen time, and clears when the reload ends', async () => {
    let lock: RestartLockHolder | null = holder;
    let now = T0;
    const emitted: DeployProjection[] = [];
    const observer = createDeployProgressObserver({
      readLockHolder: async () => lock,
      readGate: async () => idleGate,
      readLastStatus: async () => null,
      resolveProjectKey: async () => 'overdeck',
      resolveLogPath: async () => undefined,
      emit: (deploys) => emitted.push(deploys),
      now: () => now,
    });

    await observer.tick();
    now += 3_000;
    await observer.tick();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.overdeck?.startedAt).toBe(new Date(T0).toISOString());

    lock = null;
    await observer.tick();
    expect(emitted).toEqual([emitted[0], {}]);
  });

  it('feeds the read model through a schema-valid project.deploy_changed event', async () => {
    const emitted: DeployProjection[] = [];
    const observer = createDeployProgressObserver({
      readLockHolder: async () => holder,
      readGate: async () => idleGate,
      readLastStatus: async () => null,
      resolveProjectKey: async () => 'overdeck',
      resolveLogPath: async () => undefined,
      emit: (deploys) => emitted.push(deploys),
      now: () => T0,
    });
    await observer.tick();

    const event = Schema.decodeUnknownSync(DomainEvent)({
      type: 'project.deploy_changed', sequence: -1, timestamp: new Date(T0).toISOString(),
      payload: { deploys: emitted[0] },
    });
    const state = applyEvent(INITIAL_READ_MODEL_STATE, event);
    expect(state.deployByProjectKey.overdeck?.phase).toBe('building');
  });
});

describe('readLogTail', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'deploy-progress-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('returns the last non-empty lines with ANSI colour stripped', async () => {
    const path = join(dir, 'reload.log');
    await writeFile(path, ['one', '', 'two', '\u001b[32m✓ three\u001b[39m', ''].join('\n'));
    expect(await readLogTail(path, 2)).toEqual(['two', '✓ three']);
  });

  it('returns nothing for a missing file', async () => {
    expect(await readLogTail(join(dir, 'missing.log'))).toEqual([]);
  });
});
