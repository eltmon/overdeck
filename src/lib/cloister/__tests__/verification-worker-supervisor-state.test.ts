import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isVerificationWorkerActive, readVerificationWorkerState } from '../verification-worker-supervisor.js';

let tempHome: string;
let previousOverdeckHome: string | undefined;

function stateDir(issueId: string): string {
  return join(tempHome, 'verification-workers', issueId);
}

beforeEach(() => {
  previousOverdeckHome = process.env.OVERDECK_HOME;
  tempHome = mkdtempSync(join(tmpdir(), 'overdeck-verification-worker-'));
  process.env.OVERDECK_HOME = tempHome;
});

afterEach(() => {
  if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousOverdeckHome;
  rmSync(tempHome, { recursive: true, force: true });
});

describe('readVerificationWorkerState issueId matching', () => {
  it('matches an issue id case-insensitively and returns the caller\'s casing', () => {
    const dir = stateDir('pan-1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify({
      runId: 'run-1',
      issueId: 'pan-1',
      workspacePath: '/tmp/workspace',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      resultPath: join(dir, 'result-run-1.json'),
      phase: 'running',
      admittedAt: new Date().toISOString(),
    }));

    const state = readVerificationWorkerState('PAN-1');
    expect(state).not.toBeNull();
    expect(state?.issueId).toBe('PAN-1');
  });

  it('reports the worker active while the pid is alive and the result file is missing, inactive once it appears', () => {
    const dir = stateDir('pan-1');
    mkdirSync(dir, { recursive: true });
    const resultPath = join(dir, 'result-run-1.json');
    writeFileSync(join(dir, 'state.json'), JSON.stringify({
      runId: 'run-1',
      issueId: 'pan-1',
      workspacePath: '/tmp/workspace',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      resultPath,
      phase: 'running',
      admittedAt: new Date().toISOString(),
    }));

    expect(isVerificationWorkerActive('PAN-1')).toBe(true);

    writeFileSync(resultPath, '{}');

    expect(isVerificationWorkerActive('PAN-1')).toBe(false);
  });

  it('returns null when the stored issueId belongs to a different issue', () => {
    const dir = stateDir('pan-1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify({
      runId: 'run-1',
      issueId: 'pan-2',
      workspacePath: '/tmp/workspace',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      resultPath: join(dir, 'result-run-1.json'),
      phase: 'running',
      admittedAt: new Date().toISOString(),
    }));

    expect(readVerificationWorkerState('PAN-1')).toBeNull();
  });
});
