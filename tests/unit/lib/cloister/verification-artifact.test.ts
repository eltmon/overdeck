import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  pruneVerificationRunArtifacts,
  readVerificationArtifact,
  verificationArtifactPath,
  writeVerificationArtifact,
} from '../../../../src/lib/cloister/verification-artifact.js';
import type { QualityGateResult } from '../../../../src/lib/cloister/validation.js';

const gate = (overrides: Partial<QualityGateResult>): QualityGateResult => ({
  name: 'lint',
  passed: true,
  required: true,
  output: '',
  durationMs: 1000,
  ...overrides,
});

describe('verification artifact', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'verif-artifact-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('round-trips a passing run and drops passing-gate output', () => {
    writeVerificationArtifact(workspace, 'PAN-1', [
      gate({ name: 'typecheck', output: 'lots of build noise' }),
      gate({ name: 'lint', output: 'more noise' }),
    ]);

    const read = readVerificationArtifact(workspace);
    expect(read).toMatchObject({ issueId: 'PAN-1', outcome: 'passed' });
    expect(read?.failedCheck).toBeUndefined();
    expect(read?.gates).toHaveLength(2);
    expect(read?.gates.every((g) => g.output === undefined)).toBe(true);
  });

  it('records the failed check and keeps its complete output', () => {
    const output = `${'passing test output\n'.repeat(20_000)}FAIL src/example.test.ts\nAssertionError: expected true to be false`;
    writeVerificationArtifact(workspace, 'PAN-2', [
      gate({ name: 'typecheck' }),
      gate({ name: 'lint', passed: false, output, error: 'exit 1' }),
    ]);

    const read = readVerificationArtifact(workspace);
    expect(read).toMatchObject({ outcome: 'failed', failedCheck: 'lint' });
    const lint = read?.gates.find((g) => g.name === 'lint');
    expect(lint?.output).toBe(output);
    expect(lint?.output).toContain('FAIL src/example.test.ts');
    expect(lint?.output).toContain('AssertionError: expected true to be false');
    expect(lint?.output).not.toContain('chars elided');
    expect(lint?.error).toBe('exit 1');
  });

  it('ignores optional-gate failures for the overall outcome', () => {
    writeVerificationArtifact(workspace, 'PAN-3', [
      gate({ name: 'lint' }),
      gate({ name: 'coverage', passed: false, required: false }),
    ]);

    expect(readVerificationArtifact(workspace)?.outcome).toBe('passed');
  });

  it('marks an in-progress run as running with the current gate (PAN-2665 live view)', () => {
    writeVerificationArtifact(workspace, 'PAN-5', [gate({ name: 'typecheck' })], { currentGate: 'lint' });

    const read = readVerificationArtifact(workspace);
    expect(read).toMatchObject({ outcome: 'running', currentGate: 'lint' });
    expect(read?.failedCheck).toBeUndefined();
    expect(read?.gates.map((g) => g.name)).toEqual(['typecheck']);
  });

  it('returns null for a missing or corrupt artifact', () => {
    expect(readVerificationArtifact(workspace)).toBeNull();

    mkdirSync(join(workspace, '.overdeck'), { recursive: true });
    writeFileSync(verificationArtifactPath(workspace), 'not json');
    expect(readVerificationArtifact(workspace)).toBeNull();
  });
});

describe('immutable per-run verification artifacts (PAN-3847)', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'verif-run-artifact-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('two terminal runs produce two per-run files; verification-latest.json equals the second', () => {
    const first = writeVerificationArtifact(workspace, 'PAN-6', [gate({ name: 'test' })], {
      ranAt: '2026-09-17T01:00:00.000Z',
      head8: 'aaaa1111',
    });
    const second = writeVerificationArtifact(workspace, 'PAN-6', [
      gate({ name: 'lint', passed: false, output: 'the full failure output', error: 'exit 1' }),
    ], {
      ranAt: '2026-09-17T02:00:00.000Z',
      head8: 'bbbb2222',
    });

    const runsDir = join(workspace, '.overdeck', 'verification');
    const files = readdirSync(runsDir);
    expect(files).toHaveLength(2);
    expect(files).toContain('2026-09-17T01-00-00-000Z-aaaa1111.json');
    expect(files).toContain('2026-09-17T02-00-00-000Z-bbbb2222.json');

    expect(first.path).toBe(join(runsDir, '2026-09-17T01-00-00-000Z-aaaa1111.json'));
    expect(second.path).toBe(join(runsDir, '2026-09-17T02-00-00-000Z-bbbb2222.json'));

    // The failed gate's full output is in the immutable per-run file…
    const perRun = JSON.parse(readFileSync(second.path!, 'utf-8'));
    expect(perRun.gates.find((g: { name: string }) => g.name === 'lint').output).toBe('the full failure output');

    // …and verification-latest.json is a copy of the second run.
    const latest = JSON.parse(readFileSync(verificationArtifactPath(workspace), 'utf-8'));
    expect(latest.ranAt).toBe('2026-09-17T02:00:00.000Z');
    expect(latest.outcome).toBe('failed');
    expect(readVerificationArtifact(workspace)?.failedCheck).toBe('lint');
  });

  it('progress (running) writes never create per-run files', () => {
    const artifact = writeVerificationArtifact(workspace, 'PAN-7', [gate({ name: 'test' })], {
      currentGate: 'lint',
    });

    expect(artifact.path).toBeUndefined();
    expect(existsSync(join(workspace, '.overdeck', 'verification'))).toBe(false);
    expect(readVerificationArtifact(workspace)?.outcome).toBe('running');
  });

  it('pruneVerificationRunArtifacts removes files older than 30 days only', () => {
    const runsDir = join(workspace, '.overdeck', 'verification');
    mkdirSync(runsDir, { recursive: true });
    const oldFile = join(runsDir, '2026-08-01T00-00-00-000Z-deadbeef.json');
    const newFile = join(runsDir, '2026-09-16T00-00-00-000Z-cafe0000.json');
    writeFileSync(oldFile, '{}');
    writeFileSync(newFile, '{}');
    const old = Date.parse('2026-08-01T00:00:00.000Z');
    const now = Date.parse('2026-09-17T00:00:00.000Z');
    utimesSync(oldFile, old / 1000, old / 1000);

    expect(pruneVerificationRunArtifacts(workspace, now)).toBe(1);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(newFile)).toBe(true);
    // Missing directory is a no-op.
    expect(pruneVerificationRunArtifacts(join(workspace, 'nonexistent-ws'), now)).toBe(0);
  });
});
